ALTER TABLE IF EXISTS "topics" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE IF EXISTS "topics" CASCADE;--> statement-breakpoint
ALTER TABLE "questions" DROP CONSTRAINT IF EXISTS "questions_topic_id_topics_id_fk";
--> statement-breakpoint
ALTER TABLE "questions" DROP CONSTRAINT IF EXISTS "questions_approved_by_users_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_questions_topic_id";--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "subject_id" uuid;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN IF NOT EXISTS "scheduled_start_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exams_subject_id_subjects_id_fk') THEN
		ALTER TABLE "exams" ADD CONSTRAINT "exams_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exams_batch_id_batches_id_fk') THEN
		ALTER TABLE "exams" ADD CONSTRAINT "exams_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exams_subject_id" ON "exams" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exams_batch_id" ON "exams" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "questions" DROP COLUMN IF EXISTS "topic_id";--> statement-breakpoint
ALTER TABLE "questions" DROP COLUMN IF EXISTS "approved_by";--> statement-breakpoint
ALTER TABLE "questions" DROP COLUMN IF EXISTS "approved_at";
