import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../database/db.js";
import { redis } from "../../database/redis.js";
import type { answerStatusEnum } from "../../database/schemas/enums.js";
import {
    answers,
    attempts,
    candidates,
    deviceRegistrations,
    eventLogs,
    examBatches,
    exams,
    users,
    violationReports,
} from "../../database/schemas/index.js";
import {
    cancelAutoSubmit,
    scheduleAutoSubmit,
} from "../../services/timer-scheduler.js";
import { sseManager } from "../../sse/sse-manager.js";

/**
 * Broadcast a session status change via SSE to:
 * 1. The candidate's attempt room (so the candidate gets notified)
 * 2. The exam batch room (so admin monitors get notified)
 *
 * Uses an in-memory cache for attemptId → examBatchId to avoid a DB query
 * on every broadcast (critical for 500+ concurrent connections).
 */
const attemptBatchCache = new Map<string, string>();

/** Clean up cache entry for an attempt (call on submit/terminate). */
function clearAttemptBatchCache(attemptId: string): void {
  attemptBatchCache.delete(attemptId);
}

async function broadcastSessionEvent(
  attemptId: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const payload = { ...data, attemptId, serverTime: Date.now() };

  // Broadcast to the attempt room (candidate)
  sseManager.broadcast(`attempt:${attemptId}`, event, payload);

  // Look up examBatchId from cache, fall back to DB
  let examBatchId = attemptBatchCache.get(attemptId);
  if (!examBatchId) {
    const [attempt] = await db
      .select({ examBatchId: attempts.examBatchId })
      .from(attempts)
      .where(eq(attempts.id, attemptId))
      .limit(1);
    examBatchId = attempt?.examBatchId ?? undefined;
    if (examBatchId) {
      attemptBatchCache.set(attemptId, examBatchId);
      // Clean up cache after 1 hour to prevent unbounded growth
      setTimeout(() => attemptBatchCache.delete(attemptId), 3_600_000);
    }
  }

  if (examBatchId) {
    sseManager.broadcast(`examBatch:${examBatchId}`, event, payload);
  }
}

type AttemptStatus =
  | "not_started"
  | "in_progress"
  | "paused"
  | "submitted"
  | "auto_submitted"
  | "force_submitted"
  | "terminated"
  | "abandoned";

type AnswerStatus =
  | "not_visited"
  | "visited"
  | "answered"
  | "marked_for_review"
  | "answered_and_marked";

export async function validateDevice(opts: {
  deviceId: string;
  examBatchId: string;
}): Promise<{ id: string }> {
  const rows = await db
    .select({
      deviceId: deviceRegistrations.id,
      deviceStatus: deviceRegistrations.status,
    })
    .from(deviceRegistrations)
    .innerJoin(examBatches, eq(examBatches.id, opts.examBatchId))
    .where(eq(deviceRegistrations.id, opts.deviceId))
    .limit(1);

  if (rows.length === 0) throw new Error("Device not found");

  const r = rows[0];
  if (r.deviceStatus !== "active" && r.deviceStatus !== "registered") {
    throw new Error(
      `Device status is ${r.deviceStatus}, must be active or registered`,
    );
  }

  return { id: r.deviceId };
}

export async function startOrResumeAttempt(opts: {
  attemptId: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{
  attemptId: string;
  status: AttemptStatus;
  remainingTimeSecs: number;
  startedAt: number | null;
  submittedAt: number | null;
  isReconnected: boolean;
  lastQuestionIdSeen: string | null;
}> {
  const attempt = await db
    .select()
    .from(attempts)
    .where(eq(attempts.id, opts.attemptId))
    .limit(1);

  if (attempt.length === 0) throw new Error("Attempt not found");

  const a = attempt[0];

  if (
    [
      "submitted",
      "auto_submitted",
      "force_submitted",
      "terminated",
      "abandoned",
    ].includes(a.status)
  ) {
    return {
      attemptId: a.id,
      status: a.status as AttemptStatus,
      remainingTimeSecs: 0,
      startedAt: a.startedAt?.getTime() ?? null,
      submittedAt: a.submittedAt?.getTime() ?? null,
      isReconnected: false,
      lastQuestionIdSeen: a.lastQuestionIdSeen,
    };
  }

  const now = Date.now();

  if (a.status === "not_started" && !a.startedAt) {
    // Single JOIN query instead of 2 sequential queries
    const batchExam = await db
      .select({
        examId: examBatches.examId,
        scheduledEndAt: examBatches.scheduledEndAt,
        gracePeriodMinutes: examBatches.gracePeriodMinutes,
        durationMinutes: exams.durationMinutes,
      })
      .from(examBatches)
      .innerJoin(exams, eq(exams.id, examBatches.examId))
      .where(eq(examBatches.id, a.examBatchId))
      .limit(1);

    if (batchExam.length === 0) throw new Error("Exam batch not found");

    const durationSecs = batchExam[0].durationMinutes * 60;
    const remainingTimeSecs = a.remainingTimeSecs ?? durationSecs;

    await db
      .update(attempts)
      .set({
        status: "in_progress",
        startedAt: new Date(now),
        remainingTimeSecs,
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
        updatedAt: new Date(now),
      })
      .where(eq(attempts.id, a.id));

    await db.insert(eventLogs).values({
      attemptId: a.id,
      eventType: "session_started",
      eventDataJson: { ipAddress: opts.ipAddress },
      severity: "info",
      createdAt: new Date(now),
    });

    // Schedule auto-submit in Redis ZSET at exact expiry time
    const expiryMs = now + remainingTimeSecs * 1000;
    await scheduleAutoSubmit(a.id, a.candidateId, expiryMs);

    // Set active key for disconnect detection (45s TTL, refreshed by SSE)
    await redis.set(`attempt:active:${a.id}`, "1", "EX", 120);

    return {
      attemptId: a.id,
      status: "in_progress",
      remainingTimeSecs,
      startedAt: now,
      submittedAt: null,
      isReconnected: false,
      lastQuestionIdSeen: a.lastQuestionIdSeen,
    };
  }

  if (a.status === "in_progress" || a.status === "paused") {
    const startedAtMs = a.startedAt?.getTime() ?? now;
    const elapsedSecs = Math.floor((now - startedAtMs) / 1000);
    const durationSecs = a.remainingTimeSecs ?? 0;

    let remainingSecs: number;
    if (a.status === "paused") {
      remainingSecs = a.remainingTimeSecs ?? 0;
    } else {
      remainingSecs = Math.max(0, durationSecs - elapsedSecs);
    }

    if (remainingSecs <= 0 && a.status === "in_progress") {
      await cancelAutoSubmit(a.id);
      await autoSubmitAttempt(a.id, "time_expired");
      return {
        attemptId: a.id,
        status: "auto_submitted" as AttemptStatus,
        remainingTimeSecs: 0,
        startedAt: startedAtMs,
        submittedAt: now,
        isReconnected: true,
        lastQuestionIdSeen: a.lastQuestionIdSeen,
      };
    }

    const reconnectCount = a.reconnectedCount + 1;
    await db
      .update(attempts)
      .set({
        isReconnected: true,
        reconnectedCount: reconnectCount,
        reconnectedAt: new Date(now),
        updatedAt: new Date(now),
        ...(a.status === "paused" ? {} : { remainingTimeSecs: remainingSecs }),
      })
      .where(eq(attempts.id, a.id));

    // Reschedule auto-submit with updated remaining time (only if in_progress, not paused)
    if (a.status === "in_progress") {
      const expiryMs = now + remainingSecs * 1000;
      await cancelAutoSubmit(a.id);
      await scheduleAutoSubmit(a.id, a.candidateId, expiryMs);
      // Refresh active key for disconnect detection
      await redis.set(`attempt:active:${a.id}`, "1", "EX", 120);
    }

    await db.insert(eventLogs).values({
      attemptId: a.id,
      eventType: "session_reconnected",
      eventDataJson: { reconnectCount },
      severity: "info",
      createdAt: new Date(now),
    });

    return {
      attemptId: a.id,
      status: a.status as AttemptStatus,
      remainingTimeSecs: remainingSecs,
      startedAt: startedAtMs,
      submittedAt: null,
      isReconnected: true,
      lastQuestionIdSeen: a.lastQuestionIdSeen,
    };
  }

  return {
    attemptId: a.id,
    status: a.status as AttemptStatus,
    remainingTimeSecs: a.remainingTimeSecs ?? 0,
    startedAt: a.startedAt?.getTime() ?? null,
    submittedAt: a.submittedAt?.getTime() ?? null,
    isReconnected: false,
    lastQuestionIdSeen: a.lastQuestionIdSeen,
  };
}

export async function getAttemptAnswers(attemptId: string): Promise<
  Record<
    string,
    {
      answerData: unknown;
      status: string;
      timeSpentSecs: number;
      isMarkedForReview: boolean;
    }
  >
> {
  const rows = await db
    .select({
      questionId: answers.questionId,
      answerDataJson: answers.answerDataJson,
      status: answers.status,
      timeSpentSecs: answers.timeSpentSecs,
      isMarkedForReview: answers.isMarkedForReview,
    })
    .from(answers)
    .where(eq(answers.attemptId, attemptId));

  const result: Record<
    string,
    {
      answerData: unknown;
      status: string;
      timeSpentSecs: number;
      isMarkedForReview: boolean;
    }
  > = {};

  for (const row of rows) {
    result[row.questionId] = {
      answerData: row.answerDataJson,
      status: row.status,
      timeSpentSecs: row.timeSpentSecs,
      isMarkedForReview: row.isMarkedForReview,
    };
  }

  return result;
}

export async function saveAnswer(opts: {
  attemptId: string;
  questionId: string;
  answerData?: unknown;
  status: AnswerStatus;
  timeSpentSecs: number;
  isMarkedForReview: boolean;
}): Promise<{ saved: boolean; status: string }> {
  const now = new Date();

  // Single atomic upsert using ON CONFLICT — eliminates SELECT+INSERT/UPDATE round-trip
  await db
    .insert(answers)
    .values({
      attemptId: opts.attemptId,
      questionId: opts.questionId,
      answerDataJson: opts.answerData as Record<string, unknown> | null,
      status: opts.status as (typeof answerStatusEnum.enumValues)[number],
      timeSpentSecs: opts.timeSpentSecs,
      isMarkedForReview: opts.isMarkedForReview,
      firstVisitedAt: now,
      lastUpdatedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [answers.attemptId, answers.questionId],
      set: {
        answerDataJson: opts.answerData as Record<string, unknown> | null,
        status: opts.status as (typeof answerStatusEnum.enumValues)[number],
        timeSpentSecs: opts.timeSpentSecs,
        isMarkedForReview: opts.isMarkedForReview,
        lastUpdatedAt: now,
        updatedAt: now,
      },
    });

  return { saved: true, status: opts.status };
}

export async function batchSyncAnswers(opts: {
  attemptId: string;
  answers: Array<{
    questionId: string;
    answerData?: unknown;
    status: AnswerStatus;
    timeSpentSecs: number;
    isMarkedForReview: boolean;
  }>;
}): Promise<{ savedCount: number }> {
  if (opts.answers.length === 0) return { savedCount: 0 };

  const now = new Date();

  // Single batched upsert — eliminates N sequential queries
  // Build VALUES array and use ON CONFLICT DO UPDATE
  await db
    .insert(answers)
    .values(
      opts.answers.map((ans) => ({
        attemptId: opts.attemptId,
        questionId: ans.questionId,
        answerDataJson: ans.answerData as Record<string, unknown> | null,
        status: ans.status as (typeof answerStatusEnum.enumValues)[number],
        timeSpentSecs: ans.timeSpentSecs,
        isMarkedForReview: ans.isMarkedForReview,
        firstVisitedAt: now,
        lastUpdatedAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [answers.attemptId, answers.questionId],
      set: {
        answerDataJson: sql`EXCLUDED.answer_data_json`,
        status: sql`EXCLUDED.status`,
        timeSpentSecs: sql`EXCLUDED.time_spent_secs`,
        isMarkedForReview: sql`EXCLUDED.is_marked_for_review`,
        lastUpdatedAt: sql`EXCLUDED.last_updated_at`,
        updatedAt: sql`EXCLUDED.updated_at`,
      },
    });

  return { savedCount: opts.answers.length };
}

export async function updateLastQuestionSeen(
  attemptId: string,
  questionId: string,
): Promise<void> {
  await db
    .update(attempts)
    .set({
      lastQuestionIdSeen: questionId,
      updatedAt: new Date(),
    })
    .where(eq(attempts.id, attemptId));
}

export async function pauseAttempt(
  attemptId: string,
  reason: string,
): Promise<{ remainingTimeSecs: number }> {
  const attempt = await db
    .select({
      status: attempts.status,
      startedAt: attempts.startedAt,
      remainingTimeSecs: attempts.remainingTimeSecs,
    })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .limit(1);

  if (attempt.length === 0) throw new Error("Attempt not found");
  if (attempt[0].status !== "in_progress") {
    throw new Error(`Cannot pause attempt with status ${attempt[0].status}`);
  }

  const now = Date.now();
  const startedAtMs = attempt[0].startedAt?.getTime() ?? now;
  const elapsedSecs = Math.floor((now - startedAtMs) / 1000);
  const remainingSecs = Math.max(
    0,
    (attempt[0].remainingTimeSecs ?? 0) - elapsedSecs,
  );

  await db
    .update(attempts)
    .set({
      status: "paused",
      remainingTimeSecs: remainingSecs,
      updatedAt: new Date(now),
    })
    .where(eq(attempts.id, attemptId));

  // Cancel the Redis auto-submit timer — attempt is paused
  await cancelAutoSubmit(attemptId);
  await redis.del(`attempt:active:${attemptId}`);

  await db.insert(eventLogs).values({
    attemptId,
    eventType: "session_paused",
    eventDataJson: { reason, remainingTimeSecs: remainingSecs },
    severity: "warn",
    createdAt: new Date(now),
  });

  await broadcastSessionEvent(attemptId, "session:paused", {
    reason,
    remainingTimeSecs: remainingSecs,
  });

  return { remainingTimeSecs: remainingSecs };
}

export async function resumeAttempt(
  attemptId: string,
): Promise<{ remainingTimeSecs: number }> {
  const attempt = await db
    .select({
      status: attempts.status,
      candidateId: attempts.candidateId,
      remainingTimeSecs: attempts.remainingTimeSecs,
    })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .limit(1);

  if (attempt.length === 0) throw new Error("Attempt not found");
  if (attempt[0].status !== "paused") {
    throw new Error(`Cannot resume attempt with status ${attempt[0].status}`);
  }

  const now = new Date();
  const remainingSecs = attempt[0].remainingTimeSecs ?? 0;

  await db
    .update(attempts)
    .set({
      status: "in_progress",
      startedAt: now,
      updatedAt: now,
    })
    .where(eq(attempts.id, attemptId));

  // Schedule auto-submit in Redis ZSET at exact expiry time
  const expiryMs = now.getTime() + remainingSecs * 1000;
  await scheduleAutoSubmit(attemptId, attempt[0].candidateId, expiryMs);

  // Set active key for disconnect detection
  await redis.set(`attempt:active:${attemptId}`, "1", "EX", 120);

  await db.insert(eventLogs).values({
    attemptId,
    eventType: "session_resumed",
    eventDataJson: { remainingTimeSecs: remainingSecs },
    severity: "info",
    createdAt: now,
  });

  await broadcastSessionEvent(attemptId, "session:resumed", {
    remainingTimeSecs: remainingSecs,
  });

  return { remainingTimeSecs: remainingSecs };
}

export async function submitAttempt(
  attemptId: string,
  reason: "submitted" | "force_submitted" = "submitted",
): Promise<void> {
  const now = new Date();

  await db
    .update(attempts)
    .set({
      status: reason,
      submittedAt: now,
      updatedAt: now,
    })
    .where(eq(attempts.id, attemptId));

  // Cancel any pending auto-submit timer
  await cancelAutoSubmit(attemptId);
  await redis.del(`attempt:active:${attemptId}`);

  await db.insert(eventLogs).values({
    attemptId,
    eventType: "session_submitted",
    eventDataJson: { reason },
    severity: "info",
    createdAt: now,
  });

  await broadcastSessionEvent(attemptId, "session:submitted", { reason });
  clearAttemptBatchCache(attemptId);
}

export async function autoSubmitAttempt(
  attemptId: string,
  reason: "time_expired" | "batch_closed" = "time_expired",
): Promise<void> {
  const now = new Date();

  await db
    .update(attempts)
    .set({
      status: "auto_submitted",
      submittedAt: now,
      remainingTimeSecs: 0,
      updatedAt: now,
    })
    .where(eq(attempts.id, attemptId));

  // Cancel any pending auto-submit timer (in case this was called reactively)
  await cancelAutoSubmit(attemptId);
  await redis.del(`attempt:active:${attemptId}`);

  await db.insert(eventLogs).values({
    attemptId,
    eventType: "session_auto_submitted",
    eventDataJson: { reason },
    severity: "warn",
    createdAt: now,
  });

  await broadcastSessionEvent(attemptId, "session:auto_submitted", { reason });
  clearAttemptBatchCache(attemptId);
}

export async function terminateAttempt(
  attemptId: string,
  terminatedBy: string,
  reason: string,
): Promise<void> {
  const now = new Date();

  await db
    .update(attempts)
    .set({
      status: "terminated",
      submittedAt: now,
      updatedAt: now,
    })
    .where(eq(attempts.id, attemptId));

  // Cancel any pending auto-submit timer
  await cancelAutoSubmit(attemptId);
  await redis.del(`attempt:active:${attemptId}`);

  await db.insert(eventLogs).values({
    attemptId,
    eventType: "session_terminated",
    eventDataJson: { terminatedBy, reason },
    severity: "error",
    createdAt: now,
  });

  await broadcastSessionEvent(attemptId, "session:terminated", {
    terminatedBy,
    reason,
  });
  clearAttemptBatchCache(attemptId);
}

export async function logEvent(opts: {
  attemptId: string;
  eventType: string;
  eventData: unknown;
  severity: "info" | "warn" | "error";
  clientTimestamp?: Date;
}): Promise<void> {
  await db.insert(eventLogs).values({
    attemptId: opts.attemptId,
    eventType: opts.eventType,
    eventDataJson: opts.eventData as Record<string, unknown> | null,
    severity: opts.severity,
    clientTimestamp: opts.clientTimestamp,
    createdAt: new Date(),
  });
}

export async function createViolation(opts: {
  attemptId: string;
  violationType: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  evidenceUrl?: string;
}): Promise<void> {
  await db.insert(violationReports).values({
    attemptId: opts.attemptId,
    violationType:
      opts.violationType as (typeof violationReports.violationType.enumValues)[number],
    severity:
      opts.severity as (typeof violationReports.severity.enumValues)[number],
    description: opts.description,
    evidenceUrl: opts.evidenceUrl,
    createdAt: new Date(),
  });
}

export async function getRemainingTime(attemptId: string): Promise<{
  remainingSecs: number;
  status: string;
}> {
  const attempt = await db
    .select({
      status: attempts.status,
      startedAt: attempts.startedAt,
      remainingTimeSecs: attempts.remainingTimeSecs,
    })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .limit(1);

  if (attempt.length === 0) {
    return { remainingSecs: 0, status: "not_found" };
  }

  const a = attempt[0];

  if (a.status === "paused") {
    return { remainingSecs: a.remainingTimeSecs ?? 0, status: a.status };
  }

  if (
    [
      "submitted",
      "auto_submitted",
      "force_submitted",
      "terminated",
      "abandoned",
    ].includes(a.status)
  ) {
    return { remainingSecs: 0, status: a.status };
  }

  const now = Date.now();
  const startedAtMs = a.startedAt?.getTime() ?? now;
  const elapsedSecs = Math.floor((now - startedAtMs) / 1000);
  const remainingSecs = Math.max(0, (a.remainingTimeSecs ?? 0) - elapsedSecs);

  return { remainingSecs, status: a.status };
}

export async function autoPauseAttempt(
  attemptId: string,
  reason: string = "Client disconnected",
): Promise<{ remainingTimeSecs: number } | null> {
  const attempt = await db
    .select({
      status: attempts.status,
      startedAt: attempts.startedAt,
      remainingTimeSecs: attempts.remainingTimeSecs,
    })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .limit(1);

  if (attempt.length === 0) return null;
  if (attempt[0].status !== "in_progress") return null;

  const now = Date.now();
  const startedAtMs = attempt[0].startedAt?.getTime() ?? now;
  const elapsedSecs = Math.floor((now - startedAtMs) / 1000);
  const remainingSecs = Math.max(
    0,
    (attempt[0].remainingTimeSecs ?? 0) - elapsedSecs,
  );

  await db
    .update(attempts)
    .set({
      status: "paused",
      remainingTimeSecs: remainingSecs,
      updatedAt: new Date(now),
    })
    .where(eq(attempts.id, attemptId));

  await cancelAutoSubmit(attemptId);

  // Record disconnect time in Redis for grace period auto-resume
  await redis.set(`attempt:disconnect:${attemptId}`, now.toString(), "EX", 300);

  await db.insert(eventLogs).values({
    attemptId,
    eventType: "session_auto_paused",
    eventDataJson: {
      reason,
      remainingTimeSecs: remainingSecs,
      disconnectAt: now,
    },
    severity: "warn",
    createdAt: new Date(now),
  });

  await broadcastSessionEvent(attemptId, "session:auto_paused", {
    reason,
    remainingTimeSecs: remainingSecs,
  });

  return { remainingTimeSecs: remainingSecs };
}

export async function autoResumeAttempt(
  attemptId: string,
): Promise<{ remainingTimeSecs: number } | null> {
  const attempt = await db
    .select({
      status: attempts.status,
      candidateId: attempts.candidateId,
      remainingTimeSecs: attempts.remainingTimeSecs,
    })
    .from(attempts)
    .where(eq(attempts.id, attemptId))
    .limit(1);

  if (attempt.length === 0) return null;
  if (attempt[0].status !== "paused") return null;

  // Always auto-resume when the candidate reconnects — regardless of how
  // long they were disconnected. The timer was frozen during the pause, so
  // the candidate doesn't gain extra time. The disconnect duration is
  // logged for audit purposes (admin can review in event logs).
  const disconnectTimeStr = await redis.get(`attempt:disconnect:${attemptId}`);
  const disconnectTime = disconnectTimeStr
    ? Number.parseInt(disconnectTimeStr, 10)
    : null;
  const elapsedSinceDisconnect = disconnectTime
    ? Math.floor((Date.now() - disconnectTime) / 1000)
    : null;

  const now = new Date();
  const remainingSecs = attempt[0].remainingTimeSecs ?? 0;

  await db
    .update(attempts)
    .set({
      status: "in_progress",
      startedAt: now,
      updatedAt: now,
    })
    .where(eq(attempts.id, attemptId));

  // Reschedule auto-submit
  const expiryMs = now.getTime() + remainingSecs * 1000;
  await scheduleAutoSubmit(attemptId, attempt[0].candidateId, expiryMs);

  // Set active key for disconnect detection
  await redis.set(`attempt:active:${attemptId}`, "1", "EX", 120);

  // Clean up disconnect key
  if (disconnectTimeStr) {
    await redis.del(`attempt:disconnect:${attemptId}`);
  }

  await db.insert(eventLogs).values({
    attemptId,
    eventType: "session_auto_resumed",
    eventDataJson: {
      remainingTimeSecs: remainingSecs,
      disconnectDurationSecs: elapsedSinceDisconnect,
    },
    severity: "info",
    createdAt: now,
  });

  await broadcastSessionEvent(attemptId, "session:auto_resumed", {
    remainingTimeSecs: remainingSecs,
    disconnectDurationSecs: elapsedSinceDisconnect,
  });

  return { remainingTimeSecs: remainingSecs };
}

export async function getActiveAttempts(examBatchId: string): Promise<
  Array<{
    id: string;
    candidateId: string;
    candidateName: string | null;
    status: string;
    startedAt: Date | null;
    remainingTimeSecs: number;
    isReconnected: boolean;
    reconnectedCount: number;
    ipAddress: string | null;
    userAgent: string | null;
    deviceId: string | null;
    deviceName: string | null;
  }>
> {
  // Single query with computed remaining time — eliminates N+1 getRemainingTime calls
  const rows = await db
    .select({
      id: attempts.id,
      candidateId: attempts.candidateId,
      candidateName: users.fullName,
      status: attempts.status,
      startedAt: attempts.startedAt,
      remainingTimeSecs: attempts.remainingTimeSecs,
      isReconnected: attempts.isReconnected,
      reconnectedCount: attempts.reconnectedCount,
      ipAddress: attempts.ipAddress,
      userAgent: attempts.userAgent,
      deviceId: attempts.deviceId,
      deviceName: deviceRegistrations.deviceName,
      computedRemainingSecs: sql<number>`
        CASE
          WHEN ${attempts.status} = 'paused' THEN COALESCE(${attempts.remainingTimeSecs}, 0)
          WHEN ${attempts.status} IN ('submitted', 'auto_submitted', 'force_submitted', 'terminated', 'abandoned') THEN 0
          ELSE GREATEST(0, COALESCE(${attempts.remainingTimeSecs}, 0) - EXTRACT(EPOCH FROM (NOW() - ${attempts.startedAt}))::int)
        END
      `.as("computed_remaining_secs"),
    })
    .from(attempts)
    .innerJoin(candidates, eq(candidates.id, attempts.candidateId))
    .innerJoin(users, eq(users.id, candidates.userId))
    .leftJoin(
      deviceRegistrations,
      eq(deviceRegistrations.id, attempts.deviceId),
    )
    .where(
      and(
        eq(attempts.examBatchId, examBatchId),
        inArray(attempts.status, ["in_progress", "paused", "not_started"]),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    candidateId: r.candidateId,
    candidateName: r.candidateName,
    status: r.status,
    startedAt: r.startedAt,
    remainingTimeSecs: r.computedRemainingSecs,
    isReconnected: r.isReconnected,
    reconnectedCount: r.reconnectedCount,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    deviceId: r.deviceId,
    deviceName: r.deviceName,
  }));
}
