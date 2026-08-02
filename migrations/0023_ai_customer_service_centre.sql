PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_branch_settings (
  platform_id TEXT PRIMARY KEY REFERENCES platforms(id),
  assistant_name TEXT NOT NULL DEFAULT 'Support Assistant',
  assistant_enabled INTEGER NOT NULL DEFAULT 0,
  ai_enabled INTEGER NOT NULL DEFAULT 0,
  human_takeover_enabled INTEGER NOT NULL DEFAULT 1,
  anonymous_enabled INTEGER NOT NULL DEFAULT 1,
  maintenance_enabled INTEGER NOT NULL DEFAULT 0,
  maintenance_message TEXT,
  emergency_notice TEXT,
  greeting TEXT,
  away_message TEXT,
  operating_hours_json TEXT NOT NULL DEFAULT '{}',
  appearance_json TEXT NOT NULL DEFAULT '{}',
  escalation_rules_json TEXT NOT NULL DEFAULT '{}',
  contact_options_json TEXT NOT NULL DEFAULT '{}',
  retention_days INTEGER NOT NULL DEFAULT 365,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_conversations (
  id TEXT PRIMARY KEY,
  conversation_reference TEXT NOT NULL UNIQUE,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  customer_id TEXT REFERENCES customers(id),
  platform_account_id TEXT REFERENCES customer_platform_accounts(id),
  external_conversation_id TEXT NOT NULL,
  visitor_reference_hash TEXT,
  status TEXT NOT NULL DEFAULT 'ai_handling',
  handling_mode TEXT NOT NULL DEFAULT 'ai',
  category TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'normal',
  current_page TEXT,
  page_title TEXT,
  authenticated INTEGER NOT NULL DEFAULT 0,
  identity_status TEXT NOT NULL DEFAULT 'anonymous',
  verified_email_snapshot TEXT,
  display_name_snapshot TEXT,
  customer_number_snapshot TEXT,
  service_context_json TEXT NOT NULL DEFAULT '{}',
  safe_support_flags_json TEXT NOT NULL DEFAULT '{}',
  assigned_staff_id TEXT REFERENCES staff_members(id),
  case_id TEXT REFERENCES cases(id),
  opened_at TEXT NOT NULL,
  last_customer_message_at TEXT,
  last_staff_message_at TEXT,
  last_ai_message_at TEXT,
  last_activity_at TEXT NOT NULL,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform_id, external_conversation_id)
);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  external_message_id TEXT,
  sender_type TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'customer',
  delivery_status TEXT NOT NULL DEFAULT 'accepted',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(conversation_id, external_message_id)
);

CREATE TABLE IF NOT EXISTS support_conversation_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_knowledge_articles (
  id TEXT PRIMARY KEY,
  article_reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  body_markdown TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'draft',
  sensitivity TEXT NOT NULL DEFAULT 'public_support',
  created_by TEXT,
  reviewed_by TEXT,
  review_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_knowledge_assignments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES support_knowledge_articles(id) ON DELETE CASCADE,
  platform_id TEXT REFERENCES platforms(id),
  service_code TEXT,
  account_type TEXT,
  plan_code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(article_id, platform_id, service_code, account_type, plan_code)
);

CREATE TABLE IF NOT EXISTS support_provider_escalations (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES support_conversations(id),
  case_id TEXT REFERENCES cases(id),
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  provider_name TEXT NOT NULL,
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  summary TEXT NOT NULL,
  sent_at TEXT,
  response_due_at TEXT,
  response_received_at TEXT,
  customer_updated_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_consents (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  customer_id TEXT REFERENCES customers(id),
  consent_type TEXT NOT NULL,
  consent_status TEXT NOT NULL,
  notice_version TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT REFERENCES support_conversations(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES support_messages(id) ON DELETE CASCADE,
  case_id TEXT REFERENCES cases(id),
  storage_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  malware_status TEXT NOT NULL DEFAULT 'pending',
  visibility TEXT NOT NULL DEFAULT 'case_team',
  uploaded_by_type TEXT NOT NULL,
  uploaded_by_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_staff_branch_access (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_members(id),
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  can_read INTEGER NOT NULL DEFAULT 1,
  can_reply INTEGER NOT NULL DEFAULT 0,
  can_takeover INTEGER NOT NULL DEFAULT 0,
  can_configure INTEGER NOT NULL DEFAULT 0,
  granted_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(staff_id, platform_id)
);

CREATE INDEX IF NOT EXISTS idx_support_conversations_queue
  ON support_conversations(status, priority, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_conversations_platform
  ON support_conversations(platform_id, status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_conversations_customer
  ON support_conversations(customer_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_conversation
  ON support_messages(conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_support_events_conversation
  ON support_conversation_events(conversation_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_knowledge_status
  ON support_knowledge_articles(status, category, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_assignments_platform
  ON support_knowledge_assignments(platform_id, is_active);
CREATE INDEX IF NOT EXISTS idx_support_provider_status
  ON support_provider_escalations(platform_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_staff_branch
  ON support_staff_branch_access(staff_id, platform_id);
