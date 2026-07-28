import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { db } from "../database/db.js";
import { redis } from "../database/redis.js";
import { attempts } from "../database/schemas/index.js";
import { autoPauseAttempt } from "../modules/sessions/session-service.js";
import { roomManager } from "../websocket/rooms.js";

const KEYS_PREFIX = "__keyevent@0__:expired";
const ACTIVE_KEY_TTL = 120;
let subscriber: Redis | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the disconnect watcher.
 *
 * With SSE, the primary disconnect detection is the SSE connection close
 * handler (instant auto-pause when the candidate's tab closes). This watcher
 * is a safety net for edge cases where the SSE close event doesn't fire:
 * - Server crash (SSE connections dropped without close event)
 * - Redis flush (active keys lost)
 * - Network partition (SSE close event lost)
 *
 * Method 1: Redis keyspace notifications — detects `attempt:active:<id>`
 * key expiry instantly (when keyspace notifications are enabled).
 *
 * Method 2: Fallback poller — queries the DB every 30s for in_progress
 * attempts whose active key has disappeared.
 */
export async function startDisconnectWatcher(): Promise<void> {
  // Enable Redis keyspace notifications for expired events (Ex)
  try {
    await redis.config("SET", "notify-keyspace-events", "Ex");
  } catch {
    // May fail on managed Redis (e.g. Redis Cloud) where CONFIG is disabled
    // Fallback poller will still catch disconnects
  }

  // Method 1: Redis keyspace notifications subscriber
  subscriber = redis.duplicate();
  subscriber.subscribe(KEYS_PREFIX).catch(() => {
    // Keyspace notifications may not be enabled — fallback poller will handle it
  });

  subscriber.on("message", (_channel, message) => {
    const match = message.match(/^attempt:active:(.+)$/);
    if (!match) return;
    const attemptId = match[1];
    handleAutoPause(attemptId, "Active key expired (keyspace notification)");
  });

  // Method 2: Fallback poller — safety net (SSE handles primary detection)
  pollTimer = setInterval(async () => {
    try {
      await pollForExpiredAttempts();
    } catch {
      // Silent — errors here are non-fatal
    }
  }, 30_000);
}

/**
 * Stop the disconnect watcher.
 */
export function stopDisconnectWatcher(): void {
  if (subscriber) {
    subscriber.disconnect();
    subscriber = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function handleAutoPause(
  attemptId: string,
  reason: string,
): Promise<void> {
  const result = await autoPauseAttempt(attemptId, reason);
  // autoPauseAttempt already broadcasts via SSE (broadcastSessionEvent).
  // Here we only broadcast to WebSocket clients (legacy/WS-connected admins).
  if (result) {
    roomManager.broadcast(`attempt:${attemptId}`, {
      type: "session:paused",
      attemptId,
      reason,
      autoPaused: true,
      remainingTimeSecs: result.remainingTimeSecs,
      serverTime: Date.now(),
    });
    roomManager.broadcast("admin", {
      type: "session:auto_paused",
      attemptId,
      reason,
      serverTime: Date.now(),
    });
  }
}

/**
 * Fallback: query the database for all in_progress attempts and check if
 * their `attempt:active:<id>` key still exists in Redis. If the key has
 * expired, auto-pause the attempt.
 *
 * This is a safety net — the primary disconnect detection is the SSE
 * connection close handler. This poller catches edge cases where the SSE
 * close event doesn't fire (server crash, Redis flush, network partition).
 */
async function pollForExpiredAttempts(): Promise<void> {
  // Get all in_progress attempts from the database
  const inProgressAttempts = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(eq(attempts.status, "in_progress"));

  if (inProgressAttempts.length === 0) return;

  const attemptIds = inProgressAttempts.map((a) => a.id);

  // Check which ones still have an active key in Redis (pipeline = 1 round-trip)
  const pipeline = redis.pipeline();
  for (const id of attemptIds) {
    pipeline.exists(`attempt:active:${id}`);
  }
  const results = await pipeline.exec();

  // Any attempt whose active key is missing should be auto-paused
  for (let i = 0; i < attemptIds.length; i++) {
    const exists = results?.[i]?.[1] as number;
    if (!exists) {
      handleAutoPause(attemptIds[i], "Active key expired (safety-net poller)");
    }
  }

  // Refresh active keys for WS-connected attempts that are missing one
  // (edge case: client missed a heartbeat cycle but is still connected via WS)
  const wsAttemptIds: string[] = [];
  for (const socket of roomManager.allSockets()) {
    const meta = roomManager.getMeta(socket);
    if (meta?.attemptId) {
      wsAttemptIds.push(meta.attemptId);
    }
  }
  if (wsAttemptIds.length > 0) {
    const wsPipeline = redis.pipeline();
    for (const id of wsAttemptIds) {
      wsPipeline.exists(`attempt:active:${id}`);
    }
    const wsResults = await wsPipeline.exec();
    for (let i = 0; i < wsAttemptIds.length; i++) {
      const exists = wsResults?.[i]?.[1] as number;
      if (!exists) {
        await redis.set(
          `attempt:active:${wsAttemptIds[i]}`,
          "1",
          "EX",
          ACTIVE_KEY_TTL,
        );
      }
    }
  }
}
