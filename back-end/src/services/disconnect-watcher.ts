import { redis } from "../database/redis.js";
import { autoPauseAttempt } from "../modules/sessions/session-service.js";
import { sseManager } from "../sse/sse-manager.js";
import { roomManager } from "../websocket/rooms.js";

const KEYS_PREFIX = "__keyevent@0__:expired";
let subscriber: typeof redis | null = null;

/**
 * Disconnect Watcher — SSE-only, no polling fallback.
 *
 * How it works:
 * 1. When a candidate's exam starts → backend sets `attempt:active:<id>` Redis key (TTL 120s)
 * 2. While SSE is connected → the SSE periodic refresh (every 30s) keeps the key alive
 * 3. When the candidate closes the tab → SSE connection drops → `request.raw.on("close")` fires
 *    → `autoPauseAttempt()` is called immediately (primary detection)
 * 4. Redis keyspace notification (this watcher) is a secondary detection for edge cases:
 *    - Server crash where SSE close didn't fire
 *    - Network partition where TCP RST was lost
 *    When the `attempt:active:<id>` key expires (120s after last refresh), Redis fires
 *    a keyspace notification and we auto-pause.
 *
 * NO POLLING. Detection is event-driven via:
 *   - SSE close event (instant, ~0-2s)
 *   - Redis keyspace expiry notification (up to 120s worst case)
 */
export async function startDisconnectWatcher(): Promise<void> {
  // Enable Redis keyspace notifications for expired events
  try {
    await redis.config("SET", "notify-keyspace-events", "Ex");
  } catch {
    // May fail on managed Redis — SSE close handler is still the primary detection
    console.warn("[disconnect-watcher] Could not enable keyspace notifications. SSE close handler is primary.");
  }

  // Subscribe to Redis key expiry events
  subscriber = redis.duplicate();
  await subscriber.subscribe(KEYS_PREFIX).catch(() => {
    console.warn("[disconnect-watcher] Keyspace subscription failed. Relying on SSE close handler only.");
  });

  subscriber.on("message", async (_channel, message) => {
    const match = message.match(/^attempt:active:(.+)$/);
    if (!match) return;
    const attemptId = match[1];

    // Double-check: only pause if there's NO active SSE or WS connection for this attempt
    const hasSseConnection = sseManager
      .getCandidateAttemptIds()
      .some((c) => c.attemptId === attemptId);

    if (hasSseConnection) {
      // SSE is still connected — key expired due to a timing issue, refresh it
      await redis.set(`attempt:active:${attemptId}`, "1", "EX", 120);
      return;
    }

    const hasWsConnection = roomManager
      .allSockets()
      .some((socket) => roomManager.getMeta(socket)?.attemptId === attemptId);

    if (hasWsConnection) {
      await redis.set(`attempt:active:${attemptId}`, "1", "EX", 120);
      return;
    }

    // No active connection — auto-pause
    const result = await autoPauseAttempt(attemptId, "Connection lost (key expired)");
    if (result) {
      roomManager.broadcast(`attempt:${attemptId}`, {
        type: "session:paused",
        attemptId,
        reason: "Connection lost",
        autoPaused: true,
        remainingTimeSecs: result.remainingTimeSecs,
        serverTime: Date.now(),
      });
      roomManager.broadcast("admin", {
        type: "session:auto_paused",
        attemptId,
        reason: "Connection lost (key expired)",
        serverTime: Date.now(),
      });
    }
  });
}

/**
 * Stop the disconnect watcher.
 */
export function stopDisconnectWatcher(): void {
  if (subscriber) {
    subscriber.disconnect();
    subscriber = null;
  }
}
