import { eq } from "drizzle-orm";
import { db } from "../database/db.js";
import { redis } from "../database/redis.js";
import { attempts } from "../database/schemas/index.js";
import { autoSubmitAttempt } from "../modules/sessions/session-service.js";
import { roomManager } from "../websocket/rooms.js";

const ZSET_KEY = "timer:autosubmit";
const PROMOTER_INTERVAL_MS = 1000; // 1 second
const BATCH_SIZE = 100;

let promoterId: NodeJS.Timeout | null = null;

// ─── Public API: schedule / cancel ─────────────────────────────────────────

/**
 * Schedule an auto-submit for an attempt at a specific time.
 * Uses Redis ZADD with score = expiry timestamp (ms).
 * O(log N) insertion — safe for thousands of attempts.
 */
export async function scheduleAutoSubmit(
  attemptId: string,
  candidateId: string,
  expiryMs: number,
): Promise<void> {
  const member = JSON.stringify({ attemptId, candidateId });
  await redis.zadd(ZSET_KEY, expiryMs, member);
}

/**
 * Cancel a scheduled auto-submit.
 * Called when a candidate manually submits, or when an attempt is paused.
 */
export async function cancelAutoSubmit(attemptId: string): Promise<void> {
  let scanCursor = "0";
  do {
    const [nextCursor, batch] = await redis.zscan(
      ZSET_KEY,
      scanCursor,
      "MATCH",
      `*${attemptId}*`,
      "COUNT",
      100,
    );
    for (let i = 0; i < batch.length; i += 2) {
      const member = batch[i];
      if (member.includes(attemptId)) {
        await redis.zrem(ZSET_KEY, member);
      }
    }
    scanCursor = nextCursor;
  } while (scanCursor !== "0");
}

// ─── Promoter: moves due jobs from ZSET to execution ───────────────────────

/**
 * Single promoter tick — fetch all due jobs from the Redis ZSET and process them.
 * Runs every 1s. Only touches jobs whose expiry timestamp has passed.
 */
export async function promoterTick(): Promise<void> {
  const now = Date.now();

  const due = await redis.zrangebyscore(
    ZSET_KEY,
    "-inf",
    now,
    "LIMIT",
    0,
    BATCH_SIZE,
  );
  if (due.length === 0) return;

  await redis.zremrangebyscore(ZSET_KEY, "-inf", now);

  await Promise.all(
    due.map(async (member) => {
      try {
        const { attemptId, candidateId } = JSON.parse(member) as {
          attemptId: string;
          candidateId: string;
        };
        await processExpiredAttempt(attemptId, candidateId);
      } catch (err) {
        console.error("[timer-scheduler] Failed to process due job:", err);
      }
    }),
  );
}

/**
 * Process a single expired attempt:
 * 1. Auto-submit it (sets status=auto_submitted, submittedAt=now, remainingTimeSecs=0)
 * 2. Broadcast WebSocket notification to the attempt room
 */
async function processExpiredAttempt(
  attemptId: string,
  candidateId: string,
): Promise<void> {
  // Guard: check if attempt is still in_progress (candidate may have already submitted)
  const [attempt] = await db
    .select({ status: attempts.status })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .limit(1);

  if (!attempt || attempt.status !== "in_progress") return;

  await autoSubmitAttempt(attemptId, "time_expired");

  roomManager.broadcast(`attempt:${attemptId}`, {
    type: "session:auto_submitted",
    attemptId,
    candidateId,
    reason: "time_expired",
    serverTime: Date.now(),
  });

  roomManager.broadcast(`user:${candidateId}`, {
    type: "session:auto_submitted",
    attemptId,
    reason: "time_expired",
    serverTime: Date.now(),
  });
}

/**
 * Start the server-authoritative timer scheduler.
 *
 * - Promoter: runs every 1s, checks Redis ZSET for due auto-submit jobs
 *
 * Per M2.10: Server-authoritative timer with Redis-backed scheduling.
 */
export function startTimerScheduler(): void {
  if (promoterId) {
    console.warn("[timer-scheduler] Already running — ignoring start call");
    return;
  }

  promoterId = setInterval(async () => {
    try {
      await promoterTick();
    } catch (err) {
      console.error("[timer-scheduler] Promoter tick failed:", err);
    }
  }, PROMOTER_INTERVAL_MS);
  promoterId.unref();
}

/**
 * Stop the timer scheduler.
 */
export function stopTimerScheduler(): void {
  if (promoterId) {
    clearInterval(promoterId);
    promoterId = null;
  }
}
