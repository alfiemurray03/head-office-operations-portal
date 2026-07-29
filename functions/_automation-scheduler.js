import { cleanNullableText, cleanText } from "./_shared.js";
import { assertSystemServiceEnabled, systemServiceEnabled } from "./_runtime-policy.js";
import { getSystemSettings } from "./_system-settings.js";
import { syncCustomerDirectory } from "./_customer-entra-sync.js";
import { syncStaffTenantDirectory } from "./_staff-entra-sync.js";
import { syncStripeAccounts } from "./_stripe-reconciliation.js";
import { runAllSafeSystemTests, runSystemServiceTest, SYSTEM_SERVICE_CATALOG } from "./_system-tests.js";

const readinessByDatabase = new WeakMap();
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const AUTOMATION_JOB_CATALOG = Object.freeze([
  {
    code: "customer_directory_sync",
    label: "JA Group Services ID reconciliation",
    category: "Microsoft",
    description: "Continue customer imports and Microsoft delta reconciliation.",
    settingKeys: ["automation.customer_directory_enabled", "integrations.customer_directory_enabled"],
    testService: "customer_directory"
  },
  {
    code: "staff_directory_sync",
    label: "Staff tenant reconciliation",
    category: "Microsoft",
    description: "Continue staff tenant imports and Microsoft delta reconciliation without granting portal access.",
    settingKeys: ["automation.staff_directory_enabled", "integrations.staff_directory_enabled"],
    testService: "staff_directory"
  },
  {
    code: "stripe_reconciliation",
    label: "Stripe account reconciliation",
    category: "Payments",
    description: "Import and reconcile Stripe data for one or both divisions.",
    settingKeys: ["automation.stripe_reconciliation_enabled"],
    testService: "stripe_planyx",
    parameter: "division"
  },
  {
    code: "system_tests_all",
    label: "Complete safe service diagnostics",
    category: "Assurance",
    description: "Run every non-destructive System Test Centre check and retain the results.",
    settingKeys: ["system.test_centre_enabled"],
    testService: null
  },
  {
    code: "service_health_test",
    label: "Individual service health check",
    category: "Assurance",
    description: "Run and retain one selected safe System Test Centre check.",
    settingKeys: ["system.test_centre_enabled"],
    testService: null,
    parameter: "serviceCode"
  },
  {
    code: "webhook_health_test",
    label: "Webhook processing health check",
    category: "Integrations",
    description: "Check Stripe and Didit signing configuration and failed-event queues.",
    settingKeys: ["system.test_centre_enabled"],
    testService: "webhooks"
  },
  {
    code: "connected_systems_health_test",
    label: "Connected systems health check",
    category: "Integrations",
    description: "Check registered websites, scoped credentials and recent connector contact.",
    settingKeys: ["system.test_centre_enabled", "integrations.connected_systems_enabled"],
    testService: "connected_systems"
  },
  {
    code: "security_control_health_test",
    label: "Security control-plane health check",
    category: "Security",
    description: "Check marker, restriction and manual-only critical-lockdown controls.",
    settingKeys: ["system.test_centre_enabled"],
    testService: "security_controls"
  },
  {
    code: "evidence_retention_cleanup",
    label: "Expired evidence cleanup",
    category: "Housekeeping",
    description: "Remove diagnostic and automation-run evidence after the governed retention period.",
    settingKeys: [],
    testService: null
  }
]);

const jobByCode = code => AUTOMATION_JOB_CATALOG.find(job => job.code === code) || null;
const serviceByCode = code => SYSTEM_SERVICE_CATALOG.find(service => service.code === code) || null;
const nowIso = () => new Date().toISOString();
const parseJson = (value, fallback = {}) => {
  try { return JSON.parse(value); }
  catch { return fallback; }
};

async function initialiseAutomationScheduler(env) {
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS automation_schedules (
      id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,job_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','paused','completed','disabled')),
      schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('once','interval','daily','weekly','monthly')),
      timezone TEXT NOT NULL DEFAULT 'Europe/London',schedule_json TEXT NOT NULL DEFAULT '{}',parameters_json TEXT NOT NULL DEFAULT '{}',
      next_run_at TEXT,last_run_at TEXT,last_run_status TEXT,last_error TEXT,run_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,retry_count INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 2,
      retry_delay_minutes INTEGER NOT NULL DEFAULT 15,locked_until TEXT,locked_by TEXT,
      created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_automation_schedules_due ON automation_schedules(status,next_run_at)"),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,schedule_id TEXT,schedule_name TEXT,job_code TEXT NOT NULL,job_label TEXT NOT NULL,
      trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('scheduled','manual','retry','test')),
      status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','skipped','cancelled')),
      attempt INTEGER NOT NULL DEFAULT 1,scheduled_for TEXT,initiated_by TEXT,request_id TEXT,
      started_at TEXT NOT NULL,completed_at TEXT,duration_ms INTEGER NOT NULL DEFAULT 0,result_json TEXT NOT NULL DEFAULT '{}',error_text TEXT,
      FOREIGN KEY (schedule_id) REFERENCES automation_schedules(id) ON DELETE SET NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_automation_runs_schedule ON automation_runs(schedule_id,started_at DESC)"),
    env.DB.prepare(`INSERT INTO automation_schedules
      (id,name,description,job_code,status,schedule_kind,timezone,schedule_json,parameters_json,next_run_at,max_attempts,retry_delay_minutes,created_by,created_at,updated_by,updated_at)
      VALUES ('automation-default-customer-directory','JA Group Services ID reconciliation','Continue customer directory imports and Microsoft delta reconciliation.','customer_directory_sync','enabled','interval','Europe/London','{"intervalMinutes":60}','{}',datetime('now','+10 minutes'),2,15,'system',?,'system',?)
      ON CONFLICT(id) DO NOTHING`).bind(now, now),
    env.DB.prepare(`INSERT INTO automation_schedules
      (id,name,description,job_code,status,schedule_kind,timezone,schedule_json,parameters_json,next_run_at,max_attempts,retry_delay_minutes,created_by,created_at,updated_by,updated_at)
      VALUES ('automation-default-staff-directory','Staff tenant reconciliation','Continue Microsoft staff tenant imports and delta reconciliation.','staff_directory_sync','enabled','interval','Europe/London','{"intervalMinutes":60}','{}',datetime('now','+15 minutes'),2,15,'system',?,'system',?)
      ON CONFLICT(id) DO NOTHING`).bind(now, now),
    env.DB.prepare(`INSERT INTO automation_schedules
      (id,name,description,job_code,status,schedule_kind,timezone,schedule_json,parameters_json,next_run_at,max_attempts,retry_delay_minutes,created_by,created_at,updated_by,updated_at)
      VALUES ('automation-default-stripe','Stripe account reconciliation','Reconcile Planyx and Profile Centre Stripe records.','stripe_reconciliation','enabled','interval','Europe/London','{"intervalMinutes":60}','{"division":"all"}',datetime('now','+20 minutes'),2,15,'system',?,'system',?)
      ON CONFLICT(id) DO NOTHING`).bind(now, now)
  ]);
}

export async function ensureAutomationSchedulerReady(env) {
  if (!env?.DB) throw new Error("The Head Office database is not connected.");
  if (!readinessByDatabase.has(env.DB)) {
    const promise = initialiseAutomationScheduler(env).catch(cause => {
      readinessByDatabase.delete(env.DB);
      throw cause;
    });
    readinessByDatabase.set(env.DB, promise);
  }
  return readinessByDatabase.get(env.DB);
}

function validTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(new Date());
    return true;
  } catch { return false; }
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second)
  };
}

function zonedDateToUtc(year, month, day, hour, minute, timezone) {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = target;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(new Date(guess), timezone);
    const actualValue = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const difference = target - actualValue;
    guess += difference;
    if (Math.abs(difference) < 1000) break;
  }
  return new Date(guess);
}

function plusLocalDays(year, month, day, amount) {
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function weekday(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseTime(value) {
  const match = HH_MM.exec(String(value || ""));
  if (!match) throw Object.assign(new Error("Choose a valid time of day."), { code: "INVALID_SCHEDULE_TIME", status: 400 });
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function calculateNextRun(scheduleKind, definition, timezone, after = new Date()) {
  if (!validTimezone(timezone)) throw Object.assign(new Error("Choose a valid IANA time zone."), { code: "INVALID_TIMEZONE", status: 400 });
  const threshold = new Date(after.getTime() + 1000);

  if (scheduleKind === "once") {
    const runAt = new Date(definition.runAt);
    if (Number.isNaN(runAt.getTime())) throw Object.assign(new Error("Choose a valid one-off date and time."), { code: "INVALID_RUN_AT", status: 400 });
    return runAt > threshold ? runAt.toISOString() : null;
  }

  if (scheduleKind === "interval") {
    const minutes = Number(definition.intervalMinutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 43_200) {
      throw Object.assign(new Error("The interval must be between 5 minutes and 30 days."), { code: "INVALID_INTERVAL", status: 400 });
    }
    return new Date(after.getTime() + minutes * 60_000).toISOString();
  }

  const time = parseTime(definition.time);
  const local = zonedParts(threshold, timezone);

  if (scheduleKind === "daily" || scheduleKind === "weekly") {
    const permittedDays = scheduleKind === "weekly"
      ? new Set((Array.isArray(definition.weekdays) ? definition.weekdays : []).map(Number).filter(value => value >= 0 && value <= 6))
      : null;
    if (scheduleKind === "weekly" && !permittedDays.size) {
      throw Object.assign(new Error("Choose at least one weekday."), { code: "INVALID_WEEKDAYS", status: 400 });
    }
    for (let offset = 0; offset <= 370; offset += 1) {
      const candidateDate = plusLocalDays(local.year, local.month, local.day, offset);
      if (permittedDays && !permittedDays.has(weekday(candidateDate.year, candidateDate.month, candidateDate.day))) continue;
      const candidate = zonedDateToUtc(candidateDate.year, candidateDate.month, candidateDate.day, time.hour, time.minute, timezone);
      if (candidate > threshold) return candidate.toISOString();
    }
  }

  if (scheduleKind === "monthly") {
    const requestedDay = Number(definition.dayOfMonth);
    if (!Number.isInteger(requestedDay) || requestedDay < 1 || requestedDay > 31) {
      throw Object.assign(new Error("Choose a valid day of the month."), { code: "INVALID_MONTH_DAY", status: 400 });
    }
    for (let offset = 0; offset <= 24; offset += 1) {
      const monthIndex = local.month - 1 + offset;
      const year = local.year + Math.floor(monthIndex / 12);
      const month = ((monthIndex % 12) + 12) % 12 + 1;
      const day = Math.min(requestedDay, daysInMonth(year, month));
      const candidate = zonedDateToUtc(year, month, day, time.hour, time.minute, timezone);
      if (candidate > threshold) return candidate.toISOString();
    }
  }

  throw Object.assign(new Error("The next run could not be calculated from that schedule."), { code: "INVALID_SCHEDULE", status: 400 });
}

function normaliseParameters(job, supplied = {}) {
  const parameters = supplied && typeof supplied === "object" && !Array.isArray(supplied) ? supplied : {};
  if (job.code === "stripe_reconciliation") {
    const division = ["all", "planyx", "profile-centre"].includes(parameters.division) ? parameters.division : "all";
    return { division };
  }
  if (job.code === "service_health_test") {
    const serviceCode = cleanText(parameters.serviceCode, 100);
    if (!serviceByCode(serviceCode) || serviceCode === "resend") {
      throw Object.assign(new Error("Choose a registered non-destructive service test."), { code: "INVALID_SERVICE_TEST", status: 400 });
    }
    return { serviceCode };
  }
  return {};
}

export function normaliseAutomationSchedule(input, defaults = {}) {
  const name = cleanText(input?.name, 120);
  if (name.length < 3) throw Object.assign(new Error("Enter a clear schedule name."), { code: "INVALID_SCHEDULE_NAME", status: 400 });
  const jobCode = cleanText(input?.jobCode, 100);
  const job = jobByCode(jobCode);
  if (!job) throw Object.assign(new Error("Choose a registered Head Office automation."), { code: "INVALID_AUTOMATION_JOB", status: 400 });
  const scheduleKind = cleanText(input?.scheduleKind, 20);
  if (!["once", "interval", "daily", "weekly", "monthly"].includes(scheduleKind)) {
    throw Object.assign(new Error("Choose a supported schedule type."), { code: "INVALID_SCHEDULE_KIND", status: 400 });
  }
  const timezone = cleanText(input?.timezone || defaults.timezone || "Europe/London", 100);
  if (!validTimezone(timezone)) throw Object.assign(new Error("Choose a valid IANA time zone."), { code: "INVALID_TIMEZONE", status: 400 });
  const definition = input?.schedule && typeof input.schedule === "object" && !Array.isArray(input.schedule) ? input.schedule : {};
  const nextRunAt = calculateNextRun(scheduleKind, definition, timezone, new Date(Date.now() - 1000));
  if (!nextRunAt) throw Object.assign(new Error("The one-off run time must be in the future."), { code: "RUN_TIME_IN_PAST", status: 400 });
  const maxAttempts = Number(input?.maxAttempts ?? 2);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw Object.assign(new Error("Maximum attempts must be between 1 and 5."), { code: "INVALID_MAX_ATTEMPTS", status: 400 });
  }
  const retryDelayMinutes = Number(input?.retryDelayMinutes ?? defaults.retryDelayMinutes ?? 15);
  if (!Number.isInteger(retryDelayMinutes) || retryDelayMinutes < 1 || retryDelayMinutes > 1440) {
    throw Object.assign(new Error("Retry delay must be between 1 minute and 24 hours."), { code: "INVALID_RETRY_DELAY", status: 400 });
  }
  return {
    name,
    description: cleanNullableText(input?.description, 500),
    job,
    jobCode,
    scheduleKind,
    timezone,
    definition,
    parameters: normaliseParameters(job, input?.parameters),
    nextRunAt,
    maxAttempts,
    retryDelayMinutes
  };
}

function publicSchedule(row) {
  return {
    ...row,
    schedule: parseJson(row.schedule_json, {}),
    parameters: parseJson(row.parameters_json, {})
  };
}

export async function automationCentreSnapshot(env) {
  await ensureAutomationSchedulerReady(env);
  const settings = await getSystemSettings(env);
  const [schedules, runs] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM automation_schedules ORDER BY CASE status WHEN 'enabled' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,next_run_at,name"),
    env.DB.prepare("SELECT * FROM automation_runs ORDER BY started_at DESC LIMIT 100")
  ]);
  return {
    jobs: AUTOMATION_JOB_CATALOG,
    serviceTests: SYSTEM_SERVICE_CATALOG.filter(service => service.code !== "resend"),
    schedules: (schedules.results || []).map(publicSchedule),
    recentRuns: runs.results || [],
    settings: {
      schedulerEnabled: settings.values["automation.scheduler_enabled"] !== false,
      defaultTimezone: settings.values["automation.default_timezone"] || "Europe/London",
      defaultRetryDelayMinutes: Number(settings.values["automation.default_retry_delay_minutes"] || 15),
      maxJobsPerTick: Number(settings.values["automation.max_jobs_per_tick"] || 3),
      runRetentionDays: Number(settings.values["automation.run_retention_days"] || 180)
    }
  };
}

export async function createAutomationSchedule(env, input, actor) {
  await ensureAutomationSchedulerReady(env);
  const settings = await getSystemSettings(env);
  const schedule = normaliseAutomationSchedule(input, {
    timezone: settings.values["automation.default_timezone"] || "Europe/London",
    retryDelayMinutes: Number(settings.values["automation.default_retry_delay_minutes"] || 15)
  });
  const id = crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO automation_schedules
    (id,name,description,job_code,status,schedule_kind,timezone,schedule_json,parameters_json,next_run_at,max_attempts,retry_delay_minutes,created_by,created_at,updated_by,updated_at)
    VALUES (?,?,?,?, 'enabled',?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, schedule.name, schedule.description, schedule.jobCode, schedule.scheduleKind, schedule.timezone,
      JSON.stringify(schedule.definition), JSON.stringify(schedule.parameters), schedule.nextRunAt, schedule.maxAttempts,
      schedule.retryDelayMinutes, actor.sub, now, actor.sub, now).run();
  return publicSchedule(await env.DB.prepare("SELECT * FROM automation_schedules WHERE id=?").bind(id).first());
}

export async function updateAutomationSchedule(env, id, input, actor) {
  await ensureAutomationSchedulerReady(env);
  const existing = await env.DB.prepare("SELECT * FROM automation_schedules WHERE id=?").bind(id).first();
  if (!existing) throw Object.assign(new Error("That automation schedule does not exist."), { code: "SCHEDULE_NOT_FOUND", status: 404 });
  const settings = await getSystemSettings(env);
  const schedule = normaliseAutomationSchedule(input, {
    timezone: settings.values["automation.default_timezone"] || "Europe/London",
    retryDelayMinutes: Number(settings.values["automation.default_retry_delay_minutes"] || 15)
  });
  const status = existing.status === "disabled" ? "disabled" : existing.status === "paused" ? "paused" : "enabled";
  await env.DB.prepare(`UPDATE automation_schedules SET name=?,description=?,job_code=?,status=?,schedule_kind=?,timezone=?,schedule_json=?,parameters_json=?,next_run_at=?,
    max_attempts=?,retry_delay_minutes=?,retry_count=0,locked_until=NULL,locked_by=NULL,updated_by=?,updated_at=? WHERE id=?`)
    .bind(schedule.name, schedule.description, schedule.jobCode, status, schedule.scheduleKind, schedule.timezone,
      JSON.stringify(schedule.definition), JSON.stringify(schedule.parameters), schedule.nextRunAt, schedule.maxAttempts,
      schedule.retryDelayMinutes, actor.sub, nowIso(), id).run();
  return publicSchedule(await env.DB.prepare("SELECT * FROM automation_schedules WHERE id=?").bind(id).first());
}

export async function setAutomationScheduleStatus(env, id, status, actor) {
  await ensureAutomationSchedulerReady(env);
  if (!["enabled", "paused", "disabled"].includes(status)) {
    throw Object.assign(new Error("Choose enabled, paused or disabled."), { code: "INVALID_SCHEDULE_STATUS", status: 400 });
  }
  const schedule = await env.DB.prepare("SELECT * FROM automation_schedules WHERE id=?").bind(id).first();
  if (!schedule) throw Object.assign(new Error("That automation schedule does not exist."), { code: "SCHEDULE_NOT_FOUND", status: 404 });
  let nextRunAt = schedule.next_run_at;
  if (status === "enabled" && (!nextRunAt || Date.parse(nextRunAt) <= Date.now())) {
    nextRunAt = calculateNextRun(schedule.schedule_kind, parseJson(schedule.schedule_json, {}), schedule.timezone, new Date(Date.now() - 1000));
  }
  await env.DB.prepare("UPDATE automation_schedules SET status=?,next_run_at=?,locked_until=NULL,locked_by=NULL,updated_by=?,updated_at=? WHERE id=?")
    .bind(status, nextRunAt, actor.sub, nowIso(), id).run();
  return publicSchedule(await env.DB.prepare("SELECT * FROM automation_schedules WHERE id=?").bind(id).first());
}

export async function deleteAutomationSchedule(env, id) {
  await ensureAutomationSchedulerReady(env);
  const result = await env.DB.prepare("DELETE FROM automation_schedules WHERE id=?").bind(id).run();
  if (!Number(result.meta?.changes || 0)) throw Object.assign(new Error("That automation schedule does not exist."), { code: "SCHEDULE_NOT_FOUND", status: 404 });
}

async function assertJobEnabled(env, job) {
  for (const key of job.settingKeys || []) await assertSystemServiceEnabled(env, key, job.label);
}

function countTestResults(results) {
  return results.reduce((counts, result) => {
    counts[result.status] = Number(counts[result.status] || 0) + 1;
    return counts;
  }, {});
}

async function executeJob(env, jobCode, parameters, actor, requestId, options = {}) {
  const job = jobByCode(jobCode);
  if (!job) throw Object.assign(new Error("The scheduled automation is no longer registered."), { code: "AUTOMATION_JOB_NOT_FOUND", status: 404 });
  await assertJobEnabled(env, job);

  if (options.testOnly) {
    if (job.code === "evidence_retention_cleanup") {
      const settings = await getSystemSettings(env);
      const testDays = Number(settings.values["tests.result_retention_days"] || 90);
      const runDays = Number(settings.values["automation.run_retention_days"] || 180);
      const [tests, runs] = await env.DB.batch([
        env.DB.prepare("SELECT COUNT(*) count FROM service_test_runs WHERE started_at < datetime('now', ?)").bind(`-${testDays} days`),
        env.DB.prepare("SELECT COUNT(*) count FROM automation_runs WHERE started_at < datetime('now', ?)").bind(`-${runDays} days`)
      ]);
      return { testOnly: true, expiredServiceTests: Number(tests.results?.[0]?.count || 0), expiredAutomationRuns: Number(runs.results?.[0]?.count || 0) };
    }
    if (job.code === "system_tests_all") {
      const results = await runAllSafeSystemTests(env, actor, requestId);
      return { testOnly: true, counts: countTestResults(results), results };
    }
    const serviceCode = job.code === "service_health_test" ? parameters.serviceCode : job.testService;
    if (!serviceCode) return { testOnly: true, ready: true, message: "The automation configuration is valid." };
    const result = await runSystemServiceTest(env, serviceCode, actor, requestId, { mode: "safe" });
    return { testOnly: true, result };
  }

  if (job.code === "customer_directory_sync") {
    return syncCustomerDirectory(env, "delta", actor.sub || "system:automation-scheduler");
  }
  if (job.code === "staff_directory_sync") {
    return syncStaffTenantDirectory(env, "delta", actor.sub || "system:automation-scheduler");
  }
  if (job.code === "stripe_reconciliation") {
    const division = ["planyx", "profile-centre"].includes(parameters.division) ? parameters.division : null;
    if (division === "planyx") await assertSystemServiceEnabled(env, "integrations.stripe_planyx_enabled", "Planyx Stripe");
    if (division === "profile-centre") await assertSystemServiceEnabled(env, "integrations.stripe_profile_centre_enabled", "Profile Centre Stripe");
    if (!division) {
      const planyx = await systemServiceEnabled(env, "integrations.stripe_planyx_enabled", true);
      const profile = await systemServiceEnabled(env, "integrations.stripe_profile_centre_enabled", true);
      if (!planyx && !profile) throw Object.assign(new Error("Both Stripe divisions are disabled in System Settings."), { code: "SYSTEM_SERVICE_DISABLED", status: 503 });
      if (planyx !== profile) return syncStripeAccounts(env, { mode: "full", division: planyx ? "planyx" : "profile-centre" });
    }
    return syncStripeAccounts(env, { mode: "full", ...(division ? { division } : {}) });
  }
  if (job.code === "system_tests_all") {
    const results = await runAllSafeSystemTests(env, actor, requestId);
    return { counts: countTestResults(results), results };
  }
  if (job.code === "service_health_test") return runSystemServiceTest(env, parameters.serviceCode, actor, requestId, { mode: "safe" });
  if (job.code === "webhook_health_test") return runSystemServiceTest(env, "webhooks", actor, requestId, { mode: "safe" });
  if (job.code === "connected_systems_health_test") return runSystemServiceTest(env, "connected_systems", actor, requestId, { mode: "safe" });
  if (job.code === "security_control_health_test") return runSystemServiceTest(env, "security_controls", actor, requestId, { mode: "safe" });
  if (job.code === "evidence_retention_cleanup") {
    const settings = await getSystemSettings(env);
    const testDays = Math.max(7, Math.min(Number(settings.values["tests.result_retention_days"] || 90), 365));
    const runDays = Math.max(30, Math.min(Number(settings.values["automation.run_retention_days"] || 180), 730));
    const [tests, runs] = await env.DB.batch([
      env.DB.prepare("DELETE FROM service_test_runs WHERE started_at < datetime('now', ?)").bind(`-${testDays} days`),
      env.DB.prepare("DELETE FROM automation_runs WHERE started_at < datetime('now', ?) AND status!='running'").bind(`-${runDays} days`)
    ]);
    return { removedServiceTests: Number(tests.meta?.changes || 0), removedAutomationRuns: Number(runs.meta?.changes || 0) };
  }
  throw Object.assign(new Error("The scheduled automation is not implemented."), { code: "AUTOMATION_JOB_NOT_IMPLEMENTED", status: 500 });
}

async function recordRunStart(env, schedule, triggerKind, actor, requestId, attempt, scheduledFor) {
  const job = jobByCode(schedule.job_code);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO automation_runs
    (id,schedule_id,schedule_name,job_code,job_label,trigger_kind,status,attempt,scheduled_for,initiated_by,request_id,started_at)
    VALUES (?,?,?,?,?,?,'running',?,?,?,?,?)`)
    .bind(id, schedule.id, schedule.name, schedule.job_code, job?.label || schedule.job_code, triggerKind, attempt,
      scheduledFor || null, actor.sub || null, requestId || null, nowIso()).run();
  return id;
}

async function completeRun(env, runId, status, started, result, errorText) {
  await env.DB.prepare("UPDATE automation_runs SET status=?,completed_at=?,duration_ms=?,result_json=?,error_text=? WHERE id=?")
    .bind(status, nowIso(), Date.now() - started, JSON.stringify(result || {}), cleanNullableText(errorText, 2000), runId).run();
}

export async function runAutomationScheduleNow(env, id, actor, requestId, options = {}) {
  await ensureAutomationSchedulerReady(env);
  const schedule = await env.DB.prepare("SELECT * FROM automation_schedules WHERE id=?").bind(id).first();
  if (!schedule) throw Object.assign(new Error("That automation schedule does not exist."), { code: "SCHEDULE_NOT_FOUND", status: 404 });
  const triggerKind = options.testOnly ? "test" : options.retry ? "retry" : "manual";
  const runId = await recordRunStart(env, schedule, triggerKind, actor, requestId, 1, null);
  const started = Date.now();
  try {
    const result = await executeJob(env, schedule.job_code, parseJson(schedule.parameters_json, {}), actor, requestId, { testOnly: Boolean(options.testOnly) });
    await completeRun(env, runId, "succeeded", started, result, null);
    if (!options.testOnly) {
      await env.DB.prepare("UPDATE automation_schedules SET last_run_at=?,last_run_status='succeeded',last_error=NULL,run_count=run_count+1,updated_at=? WHERE id=?")
        .bind(nowIso(), nowIso(), id).run();
    }
    return { runId, status: "succeeded", result };
  } catch (cause) {
    await completeRun(env, runId, "failed", started, {}, cause?.message || "Automation failed");
    if (!options.testOnly) {
      await env.DB.prepare("UPDATE automation_schedules SET last_run_at=?,last_run_status='failed',last_error=?,run_count=run_count+1,failure_count=failure_count+1,updated_at=? WHERE id=?")
        .bind(nowIso(), cleanText(cause?.message || "Automation failed", 2000), nowIso(), id).run();
    }
    throw cause;
  }
}

async function claimDueSchedules(env, maximum, workerId) {
  const due = await env.DB.prepare(`SELECT * FROM automation_schedules
    WHERE status='enabled' AND next_run_at IS NOT NULL AND next_run_at<=? AND (locked_until IS NULL OR locked_until<?)
    ORDER BY next_run_at LIMIT ?`).bind(nowIso(), nowIso(), maximum).all();
  const claimed = [];
  const lockUntil = new Date(Date.now() + 10 * 60_000).toISOString();
  for (const schedule of due.results || []) {
    const result = await env.DB.prepare(`UPDATE automation_schedules SET locked_until=?,locked_by=?
      WHERE id=? AND status='enabled' AND next_run_at=? AND (locked_until IS NULL OR locked_until<?)`)
      .bind(lockUntil, workerId, schedule.id, schedule.next_run_at, nowIso()).run();
    if (Number(result.meta?.changes || 0)) claimed.push(schedule);
  }
  return claimed;
}

async function runClaimedSchedule(env, schedule, workerId, requestId) {
  const actor = { sub: "system:automation-scheduler", displayName: "Head Office Automation Scheduler" };
  const scheduledFor = schedule.next_run_at;
  const attempt = Number(schedule.retry_count || 0) + 1;
  const runId = await recordRunStart(env, schedule, attempt > 1 ? "retry" : "scheduled", actor, requestId, attempt, scheduledFor);
  const started = Date.now();
  try {
    const result = await executeJob(env, schedule.job_code, parseJson(schedule.parameters_json, {}), actor, requestId);
    await completeRun(env, runId, "succeeded", started, result, null);
    const nextRunAt = schedule.schedule_kind === "once"
      ? null
      : calculateNextRun(schedule.schedule_kind, parseJson(schedule.schedule_json, {}), schedule.timezone, new Date(scheduledFor || Date.now()));
    const resultingStatus = schedule.schedule_kind === "once" ? "completed" : "enabled";
    await env.DB.prepare(`UPDATE automation_schedules SET status=CASE WHEN status='paused' THEN 'paused' ELSE ? END,
      next_run_at=?,last_run_at=?,last_run_status='succeeded',last_error=NULL,run_count=run_count+1,retry_count=0,
      locked_until=NULL,locked_by=NULL,updated_by='system:automation-scheduler',updated_at=? WHERE id=? AND locked_by=?`)
      .bind(resultingStatus, nextRunAt, nowIso(), nowIso(), schedule.id, workerId).run();
    return { scheduleId: schedule.id, runId, status: "succeeded", nextRunAt };
  } catch (cause) {
    await completeRun(env, runId, "failed", started, {}, cause?.message || "Automation failed");
    const maxAttempts = Math.max(1, Number(schedule.max_attempts || 1));
    const shouldRetry = attempt < maxAttempts;
    const nextRunAt = shouldRetry
      ? new Date(Date.now() + Math.max(1, Number(schedule.retry_delay_minutes || 15)) * 60_000).toISOString()
      : schedule.schedule_kind === "once"
        ? null
        : calculateNextRun(schedule.schedule_kind, parseJson(schedule.schedule_json, {}), schedule.timezone, new Date(scheduledFor || Date.now()));
    const resultingStatus = schedule.schedule_kind === "once" && !shouldRetry ? "completed" : "enabled";
    await env.DB.prepare(`UPDATE automation_schedules SET status=CASE WHEN status='paused' THEN 'paused' ELSE ? END,
      next_run_at=?,last_run_at=?,last_run_status='failed',last_error=?,run_count=run_count+1,failure_count=failure_count+1,
      retry_count=?,locked_until=NULL,locked_by=NULL,updated_by='system:automation-scheduler',updated_at=? WHERE id=? AND locked_by=?`)
      .bind(resultingStatus, nextRunAt, nowIso(), cleanText(cause?.message || "Automation failed", 2000), shouldRetry ? attempt : 0,
        nowIso(), schedule.id, workerId).run();
    return { scheduleId: schedule.id, runId, status: "failed", error: cause?.message || "Automation failed", retryPending: shouldRetry, nextRunAt };
  }
}

export async function processDueAutomationSchedules(env, requestId = null) {
  await ensureAutomationSchedulerReady(env);
  const settings = await getSystemSettings(env);
  if (settings.values["automation.scheduler_enabled"] === false) {
    return { enabled: false, processed: 0, results: [], completedAt: nowIso() };
  }
  const maximum = Math.max(1, Math.min(Number(settings.values["automation.max_jobs_per_tick"] || 3), 10));
  const workerId = `scheduler:${crypto.randomUUID()}`;
  const claimed = await claimDueSchedules(env, maximum, workerId);
  const results = [];
  for (const schedule of claimed) results.push(await runClaimedSchedule(env, schedule, workerId, requestId));
  return { enabled: true, processed: results.length, results, completedAt: nowIso() };
}
