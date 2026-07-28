-- Add section_name column to questions table
ALTER TABLE questions ADD COLUMN IF NOT EXISTS section_name VARCHAR(255);
