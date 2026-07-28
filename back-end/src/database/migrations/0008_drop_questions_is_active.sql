-- Drop is_active column from questions table
ALTER TABLE questions DROP COLUMN IF EXISTS is_active;
