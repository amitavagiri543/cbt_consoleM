import { and, eq, inArray } from "drizzle-orm";
import { type FastifyPluginAsync } from "fastify";
import { db } from "../database/db.js";
import { redis } from "../database/redis.js";
import { attempts, candidates } from "../database/schemas/index.js";
import {
    autoPauseAttempt,
    autoResumeAttempt,
    getRemainingTime,
} from "../modules/sessions/session-service.js";
import { verifyToken } from "../services/auth.js";
import { sseManager } from "./sse-manager.js";

/**
 * Cache for userId → candidateId lookups.
 * Prevents a DB query on every SSE reconnection (500 candidates reconnecting
 * after a server restart = 500 queries without this cache).
 * TTL: 10 minutes (candidates don't change userId mapping).
 */
const candidateIdCache = new Map<string, string>();

async function getCandidateId(userId: string): Promise<string | null> {
  const cached = candidateIdCache.get(userId);
  if (cached) return cached;

  const [candidate] = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(eq(candidates.userId, userId))
    .limit(1);
  if (!candidate) return null;

  candidateIdCache.set(userId, candidate.id);
  // Auto-clean after 10 minutes
  setTimeout(() => candidateIdCache.delete(userId), 600_000);
  return candidate.id;
}

/**
 * SSE Routes — Server-Sent Events for real-time updates.
 *
 * Endpoints:
 *   GET /sse/candidate  — Candidate receives events for their active attempt
 *   GET /sse/admin      — Admin receives events for all attempts in a batch
 */
const sseRoutesPlugin: FastifyPluginAsync = async (app) => {
  // ─── Periodic active-key refresh ────────────────────────────────────
  // The `attempt:active:<id>` Redis key (45s TTL) is used by the disconnect
  // watcher as a safety net to detect stale attempts. Refresh it every 30s
  // for all connected candidate SSE clients so the key doesn't expire while
  // the SSE connection is alive. Uses a single pipeline for all clients.
  const activeKeyRefreshTimer = setInterval(async () => {
    const candidates = sseManager.getCandidateAttemptIds();
    if (candidates.length === 0) return;
    const pipeline = redis.pipeline();
    for (const { attemptId } of candidates) {
      pipeline.set(`attempt:active:${attemptId}`, "1", "EX", 120);
    }
    await pipeline.exec();
  }, 30_000);
  activeKeyRefreshTimer.unref?.();

  // ─── GET /sse/candidate — Candidate SSE stream ──────────────────────
  // Auth: Bearer token in Authorization header (EventSource doesn't support
  // custom headers, so we also accept ?token= query param).
  app.get("/candidate", async (request, reply) => {
    // Auth — accept token from query param (EventSource limitation)
    const token =
      (request.query as { token?: string }).token ??
      request.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return reply.code(401).send({ error: "Missing token" });
    }

    let payload: { sub: string; role: string; jti: string };
    try {
      payload = verifyToken(token);
    } catch {
      return reply.code(401).send({ error: "Invalid token" });
    }

    if (payload.role !== "candidate") {
      return reply.code(403).send({ error: "Candidate only" });
    }

    // Check session lock
    const activeJti = await redis.get(`session:active_jti:${payload.sub}`);
    if (activeJti && activeJti !== payload.jti) {
      return reply.code(401).send({
        error: "Session taken over by another login",
        code: "SESSION_TAKEN_OVER",
      });
    }

    // Refresh session lock TTL while the candidate is connected via SSE
    // (replaces the heartbeat-based lock refresh that was removed)
    await redis.expire(`session:lock:${payload.sub}`, 900);

    // Look up candidate record (cached to avoid DB query on reconnect)
    const candidateId = await getCandidateId(payload.sub);
    if (!candidateId) {
      return reply.code(403).send({ error: "Candidate not found" });
    }

    // Find active attempt
    // Find active or recently submitted attempt
    const [activeAttempt] = await db
      .select({
        id: attempts.id,
        status: attempts.status,
        examBatchId: attempts.examBatchId,
      })
      .from(attempts)
      .where(
        and(
          eq(attempts.candidateId, candidateId),
          inArray(attempts.status, [
            "in_progress",
            "paused",
            "not_started",
            "terminated",
            "submitted",
            "auto_submitted",
            "force_submitted",
          ]),
        ),
      )
      .limit(1);

    // Hijack the response — we're taking over the raw stream for SSE.
    // Without this, Fastify's response lifecycle interferes with the
    // long-lived connection and the "close" event may not fire on disconnect.
    reply.hijack();

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");

    // Register SSE client
    const client = sseManager.add({
      reply: reply.raw,
      userId: payload.sub,
      role: payload.role,
      attemptId: activeAttempt?.id,
      examBatchId: activeAttempt?.examBatchId,
    });

    // Join rooms: attempt room + exam batch room
    if (activeAttempt) {
      sseManager.join(client.id, `attempt:${activeAttempt.id}`);
      sseManager.join(client.id, `user:${payload.sub}`);
      if (activeAttempt.examBatchId) {
        sseManager.join(client.id, `examBatch:${activeAttempt.examBatchId}`);
      }
    }

    // If attempt is paused, auto-resume immediately. The candidate is
    // actively connecting (clicked Start/Resume Exam), so always resume
    // from the frozen remaining time — no admin action needed.
    // autoResumeAttempt broadcasts session:auto_resumed via broadcastSessionEvent,
    // so we don't need to send it again here (would cause duplicate toasts).
    if (activeAttempt?.status === "paused") {
      await autoResumeAttempt(activeAttempt.id);
    } else if (activeAttempt?.status === "in_progress") {
      // Refresh active key
      await redis.set(`attempt:active:${activeAttempt.id}`, "1", "EX", 120);
      // Send remaining time so the client can sync its countdown
      const { remainingSecs } = await getRemainingTime(activeAttempt.id);
      sseManager.sendTo(client.id, "session:active", {
        attemptId: activeAttempt.id,
        remainingTimeSecs: remainingSecs,
        serverTime: Date.now(),
      });
    } else if (activeAttempt?.status === "terminated") {
      sseManager.sendTo(client.id, "session:terminated", {
        attemptId: activeAttempt.id,
        serverTime: Date.now(),
      });
    } else if (
      activeAttempt?.status === "submitted" ||
      activeAttempt?.status === "auto_submitted" ||
      activeAttempt?.status === "force_submitted"
    ) {
      // Attempt already submitted — notify client immediately
      sseManager.sendTo(client.id, "session:submitted", {
        attemptId: activeAttempt.id,
        reason: activeAttempt.status,
        serverTime: Date.now(),
      });
    }

    // Keep-alive is handled by the shared SSEManager timer (single timer
    // for all connections, not per-connection — scales to 500+ clients).

    // Handle client disconnect
    request.raw.on("close", async () => {
      sseManager.remove(client.id);

      // Auto-pause the attempt when the SSE connection drops.
      // Only pause if the attempt is still in an active state.
      // autoPauseAttempt checks the current DB status (not the captured
      // status from connect time) and only pauses if still in_progress.
      if (
        activeAttempt &&
        (activeAttempt.status === "in_progress" ||
          activeAttempt.status === "paused" ||
          activeAttempt.status === "not_started")
      ) {
        try {
          await autoPauseAttempt(activeAttempt.id, "SSE connection closed");
        } catch {
          // Silent — errors here are non-fatal
        }
      }
    });
  });

  // ─── GET /sse/admin — Admin SSE stream ──────────────────────────────
  // Auth: Bearer token (or ?token= query param)
  // Query: examBatchId — which batch to monitor
  app.get("/admin", async (request, reply) => {
    const token =
      (request.query as { token?: string }).token ??
      request.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return reply.code(401).send({ error: "Missing token" });
    }

    let payload: { sub: string; role: string };
    try {
      payload = verifyToken(token);
    } catch {
      return reply.code(401).send({ error: "Invalid token" });
    }

    // Only admin roles
    if (!["super_admin", "exam_admin", "proctor"].includes(payload.role)) {
      return reply.code(403).send({ error: "Admin access required" });
    }

    const examBatchId = (request.query as { examBatchId?: string }).examBatchId;
    if (!examBatchId) {
      return reply.code(400).send({ error: "examBatchId is required" });
    }

    // Hijack the response for SSE streaming
    reply.hijack();

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");

    // Register SSE client
    const client = sseManager.add({
      reply: reply.raw,
      userId: payload.sub,
      role: payload.role,
      examBatchId,
    });

    // Join the exam batch room to receive all events for this batch
    sseManager.join(client.id, `examBatch:${examBatchId}`);
    sseManager.join(client.id, "admin");

    // Send initial confirmation
    sseManager.sendTo(client.id, "connected", {
      examBatchId,
      serverTime: Date.now(),
    });

    // Keep-alive is handled by the shared SSEManager timer.

    // Handle disconnect
    request.raw.on("close", () => {
      sseManager.remove(client.id);
    });
  });
};

export default sseRoutesPlugin;
