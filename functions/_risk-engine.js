import { cleanNullableText, cleanText } from "./_shared.js";
import { findCustomer } from "./_operations.js";
import { ensureV7Schema } from "./_v7-schema.js";
import { ensureV7Enhancements } from "./_v7-enhancements.js";

const RISK_MINIMUMS = { R0: 0, R1: 15, R2: 30, R3: 50, R4: 75 };
const ENFORCEMENT_RANK = { A0: 0, A1: 1, A2: 2, A3: 3, A4: 4, A5: 5 };
const DATA_RANK = { D0: 0, D1: 1, D2: 2, D3: 3, D4: 4 };
const CONFIDENTIALITY_RANK = { K0: 0, K1: 1, K2: 2, K3: 3 };
const SEVERITY_RANK = { "SEV-1": 1, "SEV-2": 2, "SEV-3": 3, "SEV-4": 4 };

function randomDigits(length = 6) {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return [...values].map(value => String(value % 10)).join("");
}

function reference(prefix) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${date}-${randomDigits(6)}`;
}

function inferCategory(eventType) {
  const prefix = String(eventType || "").split(".")[0];
  return ({
    auth: "authentication", identity: "identity", payment: "payment", refund: "refund",
    chargeback: "dispute", dispute: "dispute", account: "account", data: "data",
    system: "system", admin: "administration", complaint: "complaint"
  })[prefix] || "general";
}

function riskFromScore(score) {
  if (score >= 75) return "R4";
  if (score >= 50) return "R3";
  if (score >= 30) return "R2";
  if (score >= 15) return "R1";
  return "R0";
}

function maxCode(values, ranks, fallback) {
  return values.filter(Boolean).sort((a, b) => (ranks[b] ?? -1) - (ranks[a] ?? -1))[0] || fallback;
}

function mostSevere(values) {
  return values.filter(Boolean).sort((a, b) => (SEVERITY_RANK[a] ?? 99) - (SEVERITY_RANK[b] ?? 99))[0] || "SEV-4";
}

function sanitiseAttributes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const clean = {};
  for (const [key, item] of Object.entries(value).slice(0, 60)) {
    const safeKey = cleanText(key, 80);
    if (!safeKey) continue;
    if (["string", "number", "boolean"].includes(typeof item) || item === null) {
      clean[safeKey] = typeof item === "string" ? cleanText(item, 500) : item;
    }
  }
  return clean;
}

async function settingNumber(env, key, fallback) {
  const row = await env.DB.prepare("SELECT value_json FROM system_settings WHERE setting_key=?").bind(key).first();
  try {
    const value = Number(JSON.parse(row?.value_json ?? String(fallback)));
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

async function ruleApplies(env, rule, event, attributes) {
  if (rule.code === "NEW_DEVICE_PAYMENT") return attributes.newDevice === true;

  if (rule.code === "HIGH_VALUE_REFUND") {
    const threshold = await settingNumber(env, "payments.refund_approval_threshold_minor", 5000);
    return Number(event.amountMinor || 0) >= threshold;
  }

  if (rule.code === "IMPOSSIBLE_TRAVEL") {
    if (!event.customerId || !event.countryCode) return false;
    const cutoff = new Date(Date.parse(event.occurredAt) - 120 * 60_000).toISOString();
    const prior = await env.DB.prepare(`SELECT country_code FROM security_events
      WHERE id<>? AND customer_id=? AND event_type='auth.succeeded' AND occurred_at>=?
        AND country_code IS NOT NULL ORDER BY occurred_at DESC LIMIT 1`)
      .bind(event.id, event.customerId, cutoff).first();
    return Boolean(prior?.country_code && prior.country_code !== event.countryCode);
  }

  if (rule.code === "PAYMENT_METHOD_SHARING") {
    if (!event.paymentFingerprintHash) return false;
    const cutoff = new Date(Date.parse(event.occurredAt) - 30 * 24 * 60 * 60_000).toISOString();
    const row = await env.DB.prepare(`SELECT COUNT(DISTINCT customer_id) count FROM security_events
      WHERE payment_fingerprint_hash=? AND occurred_at>=? AND customer_id IS NOT NULL`)
      .bind(event.paymentFingerprintHash, cutoff).first();
    return Number(row?.count || 0) >= Number(rule.threshold_count || 3);
  }

  if (Number(rule.threshold_count || 1) <= 1) return true;

  const windowMinutes = Math.max(1, Number(rule.threshold_window_minutes || 60));
  const cutoff = new Date(Date.parse(event.occurredAt) - windowMinutes * 60_000).toISOString();
  const clauses = ["event_type=?", "occurred_at>=?"];
  const bindings = [event.eventType, cutoff];
  if (event.customerId) {
    clauses.push("customer_id=?");
    bindings.push(event.customerId);
  } else if (event.platformId) {
    clauses.push("platform_id=?");
    bindings.push(event.platformId);
  } else {
    clauses.push("source_type=?", "source_id=?");
    bindings.push(event.sourceType, event.sourceId || "");
  }
  const row = await env.DB.prepare(`SELECT COUNT(*) count FROM security_events WHERE ${clauses.join(" AND ")}`)
    .bind(...bindings).first();
  return Number(row?.count || 0) >= Number(rule.threshold_count);
}

async function writeAudit(env, actor, action, entityType, entityId, referenceValue, metadata = {}) {
  const actorType = ["staff", "system", "platform", "customer"].includes(actor.type) ? actor.type : "system";
  const actorId = actor.id || "risk-engine";
  const actorName = actor.name || "Head Office Risk Engine";
  await env.DB.prepare(`INSERT INTO audit_events
    (id,occurred_at,actor_type,actor_id,actor_name,action,action_label,entity_type,entity_id,entity_reference,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), new Date().toISOString(), actorType, actorId, actorName, action,
      action.replaceAll(".", " "), entityType, entityId, referenceValue, JSON.stringify(metadata)).run();
}

async function upsertAlert(env, event, assessment, matchedRules) {
  const alertThreshold = await settingNumber(env, "risk.alert_score_threshold", 30);
  if (assessment.score < alertThreshold) return null;
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const existing = await env.DB.prepare(`SELECT id,alert_reference FROM security_alerts
    WHERE category=? AND status IN ('new','triage','investigating')
      AND ((customer_id IS NOT NULL AND customer_id=?) OR (customer_id IS NULL AND platform_id=?))
      AND last_detected_at>=? ORDER BY last_detected_at DESC LIMIT 1`)
    .bind(event.category, event.customerId || "", event.platformId || "", cutoff).first();
  const now = new Date().toISOString();
  const title = matchedRules[0]?.name || `Risk signal: ${event.eventType}`;
  const summary = matchedRules.map(rule => rule.name).join("; ") || "A security event exceeded the review threshold.";

  if (existing) {
    await env.DB.prepare(`UPDATE security_alerts SET occurrence_count=occurrence_count+1,last_detected_at=?,
      risk_score=MAX(risk_score,?),risk_level=?,enforcement_level=?,severity=?,data_classification=?,
      confidentiality_level=?,summary=?,recommended_action=?,updated_at=? WHERE id=?`)
      .bind(now, assessment.score, assessment.riskLevel, assessment.enforcementLevel, assessment.severity,
        assessment.dataClassification, assessment.confidentialityLevel, summary,
        assessment.recommendedAction, now, existing.id).run();
    return { id: existing.id, reference: existing.alert_reference, updated: true };
  }

  const id = crypto.randomUUID();
  const alertReference = reference("ALT");
  await env.DB.prepare(`INSERT INTO security_alerts
    (id,alert_reference,customer_id,platform_id,case_id,category,title,summary,risk_score,risk_level,
     enforcement_level,severity,data_classification,confidentiality_level,status,occurrence_count,
     first_detected_at,last_detected_at,recommended_action,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',1,?,?,?,?,?)`)
    .bind(id, alertReference, event.customerId, event.platformId, event.caseId, event.category, title, summary,
      assessment.score, assessment.riskLevel, assessment.enforcementLevel, assessment.severity,
      assessment.dataClassification, assessment.confidentialityLevel, now, now,
      assessment.recommendedAction, now, now).run();
  return { id, reference: alertReference, updated: false };
}

async function createIncidentIfRequired(env, event, assessment, alert, actor) {
  const threshold = await settingNumber(env, "risk.incident_score_threshold", 85);
  const mandatoryTypes = [
    "data.unauthorised_access", "data.exfiltration_suspected", "data.loss_reported",
    "system.ransomware_detected", "account.takeover_suspected"
  ];
  if (assessment.score < threshold && !mandatoryTypes.includes(event.eventType)) return null;

  const id = crypto.randomUUID();
  const incidentReference = reference("INC");
  const now = new Date().toISOString();
  const isData = event.category === "data" || event.eventType.startsWith("data.");
  const breachHours = await settingNumber(env, "incidents.breach_assessment_hours", 72);
  const deadline = isData ? new Date(Date.parse(now) + breachHours * 60 * 60_000).toISOString() : null;

  await env.DB.prepare(`INSERT INTO security_incidents
    (id,incident_reference,category,title,description,severity,status,confidentiality_level,data_classification,
     customer_id,case_id,discovered_at,occurred_at,data_breach_status,ico_deadline_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, incidentReference, event.category, `Incident: ${event.eventType}`,
      `Automatically raised from security event ${event.reference}.`, assessment.severity,
      assessment.confidentialityLevel, assessment.dataClassification, event.customerId, event.caseId,
      now, event.occurredAt, isData ? "assessment_required" : "not_assessed", deadline, now, now).run();

  await env.DB.prepare(`INSERT INTO incident_timeline
    (id,incident_id,entry_type,summary,details_json,recorded_by,occurred_at,created_at)
    VALUES (?,?,'detection',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), id, "Incident automatically raised by the risk engine.",
      JSON.stringify({ eventReference: event.reference, alertReference: alert?.reference || null }),
      actor.id || "risk-engine", now, now).run();

  if (isData) {
    await env.DB.prepare(`INSERT INTO data_breach_assessments
      (id,incident_id,awareness_at,risk_to_rights,ico_deadline_at,created_at,updated_at)
      VALUES (?,? ,?,'not_assessed',?,?,?)`)
      .bind(crypto.randomUUID(), id, now, deadline, now, now).run();
  }

  if (alert?.id) {
    await env.DB.prepare("UPDATE security_alerts SET incident_id=?,updated_at=? WHERE id=?")
      .bind(id, now, alert.id).run();
  }

  await env.DB.prepare(`INSERT INTO operations_tasks
    (id,task_reference,service_area,task_type,customer_id,incident_id,title,description,priority,status,due_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'critical','open',?,?,?)`)
    .bind(crypto.randomUUID(), reference("TSK"), "security", "incident_triage", event.customerId, id,
      `Triage ${incidentReference}`, "Review, contain and assign the incident. Record every decision in the incident timeline.",
      new Date(Date.now() + 4 * 60 * 60_000).toISOString(), now, now).run();

  return { id, reference: incidentReference };
}

export async function ingestSecurityEvent(env, input, actor = {}) {
  await ensureV7Schema(env);
  await ensureV7Enhancements(env);

  const eventType = cleanText(input.eventType, 120).toLowerCase();
  if (!/^[a-z0-9_-]+\.[a-z0-9_.-]+$/.test(eventType)) {
    throw Object.assign(new Error("A valid namespaced eventType is required."), { status: 400, code: "INVALID_EVENT_TYPE" });
  }

  const category = cleanText(input.category || inferCategory(eventType), 60).toLowerCase();
  const customerReference = cleanNullableText(input.customerNumber || input.customerId, 100);
  const customer = customerReference ? await findCustomer(env, customerReference) : null;
  if (customerReference && !customer) {
    throw Object.assign(new Error("The referenced universal customer was not found."), { status: 404, code: "CUSTOMER_NOT_FOUND" });
  }

  const platformId = cleanNullableText(input.platformId || actor.platformId, 100);
  if (platformId && !await env.DB.prepare("SELECT id FROM platforms WHERE id=?").bind(platformId).first()) {
    throw Object.assign(new Error("The referenced platform was not found."), { status: 404, code: "PLATFORM_NOT_FOUND" });
  }

  const occurredAt = input.occurredAt && !Number.isNaN(Date.parse(input.occurredAt))
    ? new Date(input.occurredAt).toISOString()
    : new Date().toISOString();
  const attributes = sanitiseAttributes(input.attributes);
  const sourceType = cleanText(actor.type || input.sourceType || "staff", 40);
  const sourceId = cleanNullableText(actor.id || input.sourceId, 120);
  const dedupeKey = cleanNullableText(input.dedupeKey
    || (input.externalEventId ? `${actor.id || platformId || "source"}:${input.externalEventId}` : null), 240);

  if (dedupeKey) {
    const duplicate = await env.DB.prepare(`SELECT id,event_reference reference,risk_score score,
      risk_level riskLevel,enforcement_level enforcementLevel FROM security_events WHERE dedupe_key=?`)
      .bind(dedupeKey).first();
    if (duplicate) return { duplicate: true, event: duplicate, signals: [], alert: null, incident: null };
  }

  const id = crypto.randomUUID();
  const eventReference = reference("EVT");
  const receivedAt = new Date().toISOString();
  const event = {
    id,
    reference: eventReference,
    eventType,
    category,
    customerId: customer?.id || null,
    platformId,
    caseId: cleanNullableText(input.caseId, 100),
    occurredAt,
    sourceType,
    sourceId,
    amountMinor: Number.isFinite(Number(input.amountMinor)) ? Math.max(0, Math.round(Number(input.amountMinor))) : null,
    currency: cleanNullableText(input.currency, 3)?.toUpperCase() || null,
    countryCode: cleanNullableText(input.countryCode, 2)?.toUpperCase() || null,
    ipHash: cleanNullableText(input.ipHash, 128),
    deviceHash: cleanNullableText(input.deviceHash, 128),
    paymentFingerprintHash: cleanNullableText(input.paymentFingerprintHash, 128)
  };

  await env.DB.prepare(`INSERT INTO security_events
    (id,event_reference,source_type,source_id,external_event_id,event_type,category,customer_id,platform_id,case_id,
     occurred_at,received_at,amount_minor,currency,country_code,ip_hash,device_hash,payment_fingerprint_hash,
     attributes_json,dedupe_key,processing_status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'processing',?)`)
    .bind(id, eventReference, sourceType, sourceId, cleanNullableText(input.externalEventId, 160),
      eventType, category, event.customerId, platformId, event.caseId, occurredAt, receivedAt,
      event.amountMinor, event.currency, event.countryCode, event.ipHash, event.deviceHash,
      event.paymentFingerprintHash, JSON.stringify(attributes), dedupeKey, receivedAt).run();

  const ruleRows = await env.DB.prepare("SELECT * FROM detection_rules WHERE enabled=1 AND event_type=? ORDER BY base_score DESC")
    .bind(eventType).all();
  const matched = [];
  let score = 0;

  for (const rule of ruleRows.results) {
    if (!await ruleApplies(env, rule, event, attributes)) continue;
    const points = Math.max(0, Math.min(100, Number(rule.base_score || 0)));
    matched.push(rule);
    score += points;
    await env.DB.prepare(`INSERT INTO risk_signals
      (id,event_id,rule_code,points,label,rationale,created_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), id, rule.code, points, rule.name, rule.description, receivedAt).run();
  }

  const floor = matched.reduce((current, rule) => Math.max(current, RISK_MINIMUMS[rule.risk_floor] || 0), 0);
  score = Math.min(100, Math.max(score, floor));
  const riskLevel = riskFromScore(score);
  const enforcementLevel = maxCode(matched.map(rule => rule.recommended_enforcement), ENFORCEMENT_RANK,
    riskLevel === "R4" ? "A5" : riskLevel === "R3" ? "A3" : riskLevel === "R2" ? "A2" : riskLevel === "R1" ? "A1" : "A0");
  const severity = mostSevere(matched.map(rule => rule.alert_severity));
  const dataClassification = maxCode(matched.map(rule => rule.data_classification), DATA_RANK, "D2");
  const confidentialityLevel = maxCode(matched.map(rule => rule.confidentiality_level), CONFIDENTIALITY_RANK, "K1");
  const recommendedAction = ({
    A0: "Allow", A1: "Allow and monitor", A2: "Require step-up verification",
    A3: "Hold for manual approval", A4: "Apply a targeted restriction", A5: "Apply an urgent protective freeze"
  })[enforcementLevel];
  const assessment = { score, riskLevel, enforcementLevel, severity, dataClassification, confidentialityLevel, recommendedAction };

  await env.DB.prepare(`UPDATE security_events SET processing_status='processed',risk_score=?,risk_level=?,
    enforcement_level=?,data_classification=?,confidentiality_level=? WHERE id=?`)
    .bind(score, riskLevel, enforcementLevel, dataClassification, confidentialityLevel, id).run();

  if (event.customerId) {
    const customerStatus = ({ R0: "clear", R1: "monitor", R2: "review", R3: "high", R4: "critical" })[riskLevel];
    await env.DB.prepare(`UPDATE customers SET security_status=CASE
      WHEN security_status='critical' THEN security_status
      WHEN ?='critical' THEN 'critical'
      WHEN security_status='high' THEN security_status
      WHEN ?='high' THEN 'high'
      WHEN security_status='review' THEN security_status
      WHEN ?='review' THEN 'review'
      WHEN security_status='monitor' THEN security_status
      ELSE ? END,updated_at=? WHERE id=?`)
      .bind(customerStatus, customerStatus, customerStatus, customerStatus, receivedAt, event.customerId).run();
  }

  const alert = await upsertAlert(env, event, assessment, matched);
  const incident = await createIncidentIfRequired(env, event, assessment, alert, actor);
  await writeAudit(env, actor, "risk.event.processed", "security_event", id, eventReference, {
    eventType, category, score, riskLevel, enforcementLevel,
    alertReference: alert?.reference || null,
    incidentReference: incident?.reference || null
  });

  return {
    duplicate: false,
    event: { id, reference: eventReference, eventType, category, ...assessment },
    signals: matched.map(rule => ({ code: rule.code, name: rule.name, points: Number(rule.base_score) })),
    alert,
    incident
  };
}
