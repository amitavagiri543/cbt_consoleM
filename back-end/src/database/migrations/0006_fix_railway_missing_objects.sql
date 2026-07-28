-- Fix: Recreate objects from migration 0001 that partially failed on Railway
-- Uses IF NOT EXISTS / IF EXISTS so it's safe on both local and Railway

CREATE TABLE IF NOT EXISTS "batch_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_batch_subjects_batch_subject" UNIQUE("batch_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "batch_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_batch_candidates_batch_candidate" UNIQUE("batch_id","candidate_id")
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_subjects_batch_id_batches_id_fk') THEN
		ALTER TABLE "batch_subjects" ADD CONSTRAINT "batch_subjects_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_subjects_subject_id_subjects_id_fk') THEN
		ALTER TABLE "batch_subjects" ADD CONSTRAINT "batch_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_candidates_batch_id_batches_id_fk') THEN
		ALTER TABLE "batch_candidates" ADD CONSTRAINT "batch_candidates_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_candidates_candidate_id_candidates_id_fk') THEN
		ALTER TABLE "batch_candidates" ADD CONSTRAINT "batch_candidates_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_batch_subjects_batch_id" ON "batch_subjects" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_batch_subjects_subject_id" ON "batch_subjects" USING btree ("subject_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_batch_candidates_batch_id" ON "batch_candidates" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_batch_candidates_candidate_id" ON "batch_candidates" USING btree ("candidate_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subjects_institution_id" ON "subjects" USING btree ("institution_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attempts_exam_batch_status" ON "attempts" USING btree ("exam_batch_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_batches_institution_id" ON "batches" USING btree ("institution_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_candidates_institution_id" ON "candidates" USING btree ("institution_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exams_subject_id" ON "exams" USING btree ("subject_id");
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_subjects_institution_code') THEN
		ALTER TABLE "subjects" ADD CONSTRAINT "uq_subjects_institution_code" UNIQUE("institution_id","code");
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batches_code_unique') THEN
		ALTER TABLE "batches" ADD CONSTRAINT "batches_code_unique" UNIQUE("code");
	END IF;
END $$;
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."difficulty_level";
--> statement-breakpoint
-- Fix nullability: batches.institution_id and subjects.institution_id should be NOT NULL
UPDATE "batches" SET "institution_id" = (SELECT id FROM "institutions" LIMIT 1) WHERE "institution_id" IS NULL;
ALTER TABLE "batches" ALTER COLUMN "institution_id" SET NOT NULL;
--> statement-breakpoint
UPDATE "subjects" SET "institution_id" = (SELECT id FROM "institutions" LIMIT 1) WHERE "institution_id" IS NULL;
ALTER TABLE "subjects" ALTER COLUMN "institution_id" SET NOT NULL;
--> statement-breakpoint
-- Add missing FKs that drizzle-kit push named differently or didn't create
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batches_institution_id_institutions_id_fk') THEN
		ALTER TABLE "batches" ADD CONSTRAINT "batches_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exams_subject_id_subjects_id_fk') THEN
		ALTER TABLE "exams" ADD CONSTRAINT "exams_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subjects_institution_id_institutions_id_fk') THEN
		ALTER TABLE "subjects" ADD CONSTRAINT "subjects_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
-- Drop stale subjects_code_unique (replaced by uq_subjects_institution_code composite unique)
ALTER TABLE "subjects" DROP CONSTRAINT IF EXISTS "subjects_code_unique";
