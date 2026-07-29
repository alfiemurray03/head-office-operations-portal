-- Staff Directory records are independent from customer records and customer UCNs.
-- A matching email across staff_directory_profiles and customers is valid.
-- No customer foreign key or automatic identity-review relationship is created here.

CREATE TABLE IF NOT EXISTS staff_directory_profiles (
  id TEXT PRIMARY KEY,
  staff_number TEXT NOT NULL UNIQUE,
  linked_staff_member_id TEXT UNIQUE REFERENCES staff_members(id),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  job_title TEXT,
  employment_type TEXT NOT NULL DEFAULT 'employee'
    CHECK (employment_type IN ('director','employee','contractor','agency','volunteer','other')),
  organisation_unit_id TEXT REFERENCES organisation_units(id),
  division_code TEXT,
  department TEXT,
  telephone TEXT,
  internal_extension TEXT,
  start_date TEXT,
  end_date TEXT,
  directory_notes TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','left','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO staff_directory_profiles
  (id,staff_number,linked_staff_member_id,display_name,email,employment_type,status,created_at,updated_at)
SELECT 'staff-profile-' || s.id,
       'STF-' || printf('%06d', ROW_NUMBER() OVER (ORDER BY s.created_at,s.id)),
       s.id,
       s.display_name,
       s.email,
       'employee',
       CASE WHEN s.status='active' THEN 'active' ELSE 'suspended' END,
       s.created_at,
       s.updated_at
FROM staff_members s;

CREATE INDEX IF NOT EXISTS idx_staff_directory_profiles_lookup
  ON staff_directory_profiles(status,division_code,department,display_name);
CREATE INDEX IF NOT EXISTS idx_staff_directory_profiles_email
  ON staff_directory_profiles(email);

CREATE TABLE IF NOT EXISTS staff_number_sequences (
  sequence_key TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO staff_number_sequences(sequence_key,next_value,updated_at)
SELECT 'staff',
       COALESCE(MAX(CAST(substr(staff_number,5) AS INTEGER)),0)+1,
       datetime('now')
FROM staff_directory_profiles
ON CONFLICT(sequence_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS staff_manual_reviews (
  id TEXT PRIMARY KEY,
  staff_profile_id TEXT NOT NULL REFERENCES staff_directory_profiles(id),
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
CREATE INDEX IF NOT EXISTS idx_staff_manual_reviews_profile
  ON staff_manual_reviews(staff_profile_id,opened_at DESC);
