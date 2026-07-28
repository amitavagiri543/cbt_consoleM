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
import { cognitiveLevelEnum, questionTypeEnum } from "./enums.js";
import { batches, institutions, users } from "./organizational.js";

export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    institutionId: uuid("institution_id")
      .notNull()
      .references(() => institutions.id),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_subjects_institution_code").on(table.institutionId, table.code),
    index("idx_subjects_institution_id").on(table.institutionId),
  ],
);

export const batchSubjects = pgTable(
  "batch_subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_batch_subjects_batch_subject").on(
      table.batchId,
      table.subjectId,
    ),
    index("idx_batch_subjects_batch_id").on(table.batchId),
    index("idx_batch_subjects_subject_id").on(table.subjectId),
  ],
);

export const questionBanks = pgTable(
  "question_banks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_question_banks_created_by").on(table.createdBy)],
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id),
    type: questionTypeEnum("type").notNull(),
    cognitiveLevel: cognitiveLevelEnum("cognitive_level"),
    contentJson: jsonb("content_json").notNull(),
    mediaUrlsJson: jsonb("media_urls_json"),
    solutionJson: jsonb("solution_json"),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    usageCount: integer("usage_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_questions_subject_id").on(table.subjectId),
    index("idx_questions_type").on(table.type),
  ],
);

export const questionOptions = pgTable(
  "question_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id),
    optionText: text("option_text").notNull(),
    optionMediaUrl: varchar("option_media_url", { length: 500 }),
    isCorrect: boolean("is_correct").notNull(),
    displayOrder: integer("display_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_question_options_question_id").on(table.questionId)],
);

export const questionTags = pgTable(
  "question_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id),
    tag: varchar("tag", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_question_tags_question_tag").on(table.questionId, table.tag),
    index("idx_question_tags_tag").on(table.tag),
  ],
);

export const questionVersions = pgTable(
  "question_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id),
    versionNumber: integer("version_number").notNull(),
    contentJson: jsonb("content_json").notNull(),
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => users.id),
    changeReason: text("change_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_question_versions_question_version").on(
      table.questionId,
      table.versionNumber,
    ),
    index("idx_question_versions_question_id").on(table.questionId),
  ],
);
