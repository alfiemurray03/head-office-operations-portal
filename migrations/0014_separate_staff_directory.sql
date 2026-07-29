-- Separate operational staff records from customer identities.
-- A matching email in staff_members and customers is valid and must never merge the records.

ALTER TABLE staff_members ADD COLUMN staff_number TEXT;
ALTER TABLE staff_members ADD COLUMN job_title TEXT;
ALTER TABLE staff_members ADD COLUMN employment_type TEXT NOT NULL DEFAULT 'employee'
  CHECK (employment_type IN ('director','employee','contractor','agency','volunteer','other'));
ALTER TABLE staff_members ADD COLUMN organisation_unit_id TEXT REFERENCES organisation_units(id);
ALTER TABLE staff_members ADD COLUMN division_code TEXT;
ALTER TABLE staff_members ADD COLUMN department TEXT;
ALTER TABLE staff_members ADD COLUMN telephone TEXT;
ALTER TABLE staff_members ADD COLUMN internal_extension TEXT;
ALTER TABLE staff_members ADD COLUMN start_date TEXT;
ALTER TABLE staff_members ADD COLUMN end_date TEXT;
ALTER TABLE staff_members ADD COLUMN directory_notes TEXT;
ALTER TABLE staff_members ADD COLUMN portal_access_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (portal_access_enabled IN (0,1));

UPDATE staff_members
SET staff_number='STF-' || printf('%06d', rowid)
WHERE staff_number IS NULL OR trim(staff_number)='';

UPDATE staff_members
SET portal_access_enabled=1
WHERE id IN (SELECT DISTINCT staff_id FROM staff_role_assignments);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_members_staff_number
  ON staff_members(staff_number);
CREATE INDEX IF NOT EXISTS idx_staff_members_directory
  ON staff_members(status,division_code,department,display_name);

CREATE TABLE IF NOT EXISTS staff_number_sequences (
  sequence_key TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO staff_number_sequences(sequence_key,next_value,updated_at)
SELECT 'staff',
       COALESCE(MAX(CAST(substr(staff_number,5) AS INTEGER)),0)+1,
       datetime('now')
FROM staff_members
ON CONFLICT(sequence_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS staff_manual_reviews (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_members(id),
  review_type TEXT NOT NULL
    CHECK (review_type IN ('identity','security','safeguarding','conduct','right_to_work','other')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_review','completed','cancelled')),
  reason TEXT NOT NULL,
  outcome TEXT,
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_by TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_manual_reviews_queue
  ON staff_manual_reviews(status,review_type,opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_manual_reviews_staff
  ON staff_manual_reviews(staff_id,opened_at DESC);
