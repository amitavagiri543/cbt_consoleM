import {
    boolean,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    unique,
    uuid,
    varchar,
} from "drizzle-orm/pg-core";
import { questions } from "./academic.js";
import {
    answerStatusEnum,
    attemptStatusEnum,
    proctoringActionEnum,
    violationSeverityEnum,
    violationTypeEnum,
} from "./enums.js";
import { examBatches } from "./exam.js";
import { candidates, users } from "./organizational.js";
import { deviceRegistrations } from "./security.js";

export const attempts = pgTable(
  "attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    examBatchId: uuid("exam_batch_id")
      .notNull()
      .references(() => examBatches.id),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    deviceId: uuid("device_id").references(() => deviceRegistrations.id),
    status: attemptStatusEnum("status").notNull().default("not_started"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    remainingTimeSecs: integer("remaining_time_secs"),
    lastQuestionIdSeen: uuid("last_question_id_seen"),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    isReconnected: boolean("is_reconnected").notNull().default(false),
    reconnectedCount: integer("reconnected_count").notNull().default(0),
    reconnectedAt: timestamp("reconnected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_attempts_exam_batch_candidate").on(
      table.examBatchId,
      table.candidateId,
    ),
    index("idx_attempts_exam_batch_id").on(table.examBatchId),
    index("idx_attempts_candidate_id").on(table.candidateId),
    index("idx_attempts_device_id").on(table.deviceId),
    index("idx_attempts_status").on(table.status),
    index("idx_attempts_exam_batch_status").on(table.examBatchId, table.status),
  ],
);

export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id),
    answerDataJson: jsonb("answer_data_json"),
    status: answerStatusEnum("status").notNull().default("not_visited"),
    timeSpentSecs: integer("time_spent_secs").notNull().default(0),
    isMarkedForReview: boolean("is_marked_for_review").notNull().default(false),
    firstVisitedAt: timestamp("first_visited_at", { withTimezone: true }),
    lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_answers_attempt_question").on(table.attemptId, table.questionId),
    index("idx_answers_attempt_id").on(table.attemptId),
    index("idx_answers_question_id").on(table.questionId),
  ],
);

export const answerSnapshots = pgTable(
  "answer_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id),
    snapshotJson: jsonb("snapshot_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_answer_snapshots_answer_id").on(table.answerId)],
);

export const eventLogs = pgTable(
  "event_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    eventDataJson: jsonb("event_data_json"),
    severity: varchar("severity", { length: 20 }).notNull().default("info"),
    clientTimestamp: timestamp("client_timestamp", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_event_logs_attempt_id").on(table.attemptId)],
);

export const violationReports = pgTable(
  "violation_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id),
    violationType: violationTypeEnum("violation_type").notNull(),
    severity: violationSeverityEnum("severity").notNull(),
    description: text("description").notNull(),
    evidenceUrl: varchar("evidence_url", { length: 500 }),
    proctorAction: proctoringActionEnum("proctor_action"),
    proctorId: uuid("proctor_id").references(() => users.id),
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_violation_reports_attempt_id").on(table.attemptId)],
);

export const sessionTokens = pgTable(
  "session_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenJti: varchar("token_jti", { length: 255 }).notNull().unique(),
    tokenType: varchar("token_type", { length: 10 }).notNull(),
    deviceId: uuid("device_id").references(() => deviceRegistrations.id),
    attemptId: uuid("attempt_id").references(() => attempts.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    isRevoked: boolean("is_revoked").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_session_tokens_user_id").on(table.userId),
    index("idx_session_tokens_device_id").on(table.deviceId),
    index("idx_session_tokens_attempt_id").on(table.attemptId),
  ],
);

export const proctoringEvents = pgTable(
  "proctoring_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => attempts.id),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    eventDataJson: jsonb("event_data_json"),
    mediaUrl: varchar("media_url", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_proctoring_events_attempt_id").on(table.attemptId)],
);
