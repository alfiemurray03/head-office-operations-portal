import {
  cleanText,
  error,
  json,
  platformAudit,
  readJson,
  requirePlatform,
  sha256,
  validEmail
} from "../../../../_shared.js";
import {
  ensureBranchSettings,
  ensureSupportCentreSchema,
  jsonValue,
  resolveSupportCustomer,
  safeObject,
  supportReference
} from "../../../../_support-centre-schema.js";
import { allocateCaseReference, defaultDueDate, ensureOperationsReady } from "../../../../_operations.js";

const CONVERSATION_STATUSES = new Set([
  "ai_handling", "awaiting_customer", "human_assistance_requested", "assigned",
  "under_investigation", "resolved", "closed", "escalated", "security_review_required"
]);
const PRIORITIES = new Set(["low", "normal", "high", "critical"]);
const PLATFORM_SENDERS = new Set(["customer", "ai", "system"]);
const EVENTS = new Set(["heartbeat", "close", "reopen", "request_human", "customer_typing", "page_changed", "consent_recorded"]);

function segments(value) {
  if (Array.isArray(value)) return value.flatMap(item => String(item).split("/")).filter(Boolean);
  return String(value || "").split("/").filter(Boolean);
}

function hasScope(platform, required) {
  return platform.scopes.includes("support:*") || platform.scopes.includes(required);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function publicBranchConfig(row) {
  return {
    platformId: row.platform_id,
    assistantName: row.assistant_name,
    enabled: Boolean(row.assistant_enabled),
    aiEnabled: Boolean(row.ai_enabled),
    humanTakeoverEnabled: Boolean(row.human_takeover_enabled),
    anonymousEnabled: Boolean(row.anonymous_enabled),
    maintenanceEnabled: Boolean(row.maintenance_enabled),
    maintenanceMessage: row.maintenance_message || "",
    emergencyNotice: row.emergency_notice || "",
    greeting: row.greeting || "",
    awayMessage: row.away_message || "",
    operatingHours: parseJson(row.operating_hours_json, {}),
    appearance: parseJson(row.appearance_json, {}),
    contactOptions: parseJson(row.contact_options_json, {}),
    retentionDays: Number(row.retention_days || 365)
  };
}

async function authenticate(context, requiredScope) {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth;
  if (!hasScope(auth.platform, requiredScope)) {
    return { response: error("INSUFFICIENT_PLATFORM_SCOPE", `The credential requires ${requiredScope}.`, 403) };
  }
  await ensureSupportCentreSchema(context.env);
  return auth;
}

async function findConversation(env, platformId, reference) {
  const value = cleanText(reference, 180);
  if (!value) return null;
  return env.DB.prepare(`SELECT * FROM support_conversations
    WHERE platform_id=? AND (id=? OR conversation_reference=? OR external_conversation_id=?) LIMIT 1`)
    .bind(platformId, value, value, value).first();
}

async function getConfig(context, auth) {
  const settings = await ensureBranchSettings(context.env, auth.platform);
  return json({ branch: publicBranchConfig(settings) });
}

async function getKnowledge(context, auth) {
  const url = new URL(context.request.url);
  const serviceCode = cleanText(url.searchParams.get("service") || "", 80);
  const accountType = cleanText(url.searchParams.get("accountType") || "", 80);
  const planCode = cleanText(url.searchParams.get("plan") || "", 80);
  const result = await context.env.DB.prepare(`SELECT DISTINCT a.id,a.article_reference,a.title,a.summary,a.body_markdown,a.category,a.updated_at
    FROM support_knowledge_articles a
    LEFT JOIN support_knowledge_assignments x ON x.article_id=a.id AND x.is_active=1
    WHERE a.status='published' AND a.sensitivity='public_support'
      AND (x.id IS NULL OR x.platform_id IS NULL OR x.platform_id=?)
      AND (x.service_code IS NULL OR x.service_code='' OR x.service_code=?)
      AND (x.account_type IS NULL OR x.account_type='' OR x.account_type=?)
      AND (x.plan_code IS NULL OR x.plan_code='' OR x.plan_code=?)
    ORDER BY a.category,a.title LIMIT 250`)
    .bind(auth.platform.id, serviceCode, accountType, planCode).all();
  return json({ articles: result.results.map(row => ({
    id: row.id,
    reference: row.article_reference,
    title: row.title,
    summary: row.summary || "",
    body: row.body_markdown,
    category: row.category,
    updatedAt: row.updated_at
  })) });
}

async function listMessages(context, auth, conversationReference) {
  const conversation = await findConversation(context.env, auth.platform.id, conversationReference);
  if (!conversation) return error("SUPPORT_CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
  const url = new URL(context.request.url);
  const after = cleanText(url.searchParams.get("after") || "", 40);
  const result = await context.env.DB.prepare(`SELECT id,external_message_id,sender_type,sender_name,body,delivery_status,created_at
    FROM support_messages WHERE conversation_id=? AND visibility='customer'
      AND (?='' OR created_at>?) ORDER BY created_at,id LIMIT 250`)
    .bind(conversation.id, after, after).all();
  return json({
    conversation: {
      id: conversation.id,
      reference: conversation.conversation_reference,
      status: conversation.status,
      handlingMode: conversation.handling_mode,
      assigned: Boolean(conversation.assigned_staff_id),
      caseId: conversation.case_id || null,
      updatedAt: conversation.updated_at
    },
    messages: result.results.map(row => ({
      id: row.id,
      externalMessageId: row.external_message_id,
      senderType: row.sender_type,
      senderName: row.sender_name,
      body: row.body,
      deliveryStatus: row.delivery_status,
      createdAt: row.created_at
    }))
  });
}

async function startConversation(context, auth) {
  const settings = await ensureBranchSettings(context.env, auth.platform);
  if (!settings.assistant_enabled) return error("SUPPORT_BRANCH_DISABLED", "Customer support is not enabled for this website.", 503);
  if (settings.maintenance_enabled) {
    return error("SUPPORT_BRANCH_MAINTENANCE", settings.maintenance_message || "Customer support is temporarily unavailable.", 503);
  }

  let body;
  try { body = await readJson(context.request, 96_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  const externalConversationId = cleanText(body.externalConversationId || body.sessionId, 180);
  if (externalConversationId.length < 8) {
    return error("INVALID_SUPPORT_CONVERSATION", "A valid external conversation identifier is required.");
  }

  const authenticated = body.authenticated === true;
  const identity = body.identity && typeof body.identity === "object" ? body.identity : {};
  const resolved = await resolveSupportCustomer(context.env, auth.platform.id, identity);
  if (["central_customer_not_found", "ucn_not_found"].includes(resolved.match)) {
    return error("CUSTOMER_IDENTITY_REVIEW_REQUIRED", "The supplied central customer identity could not be verified.", 409);
  }
  if (!resolved.customer && !settings.anonymous_enabled) {
    return error("CUSTOMER_VERIFICATION_REQUIRED", "This support branch requires a verified customer session.", 401);
  }

  const now = new Date().toISOString();
  const existing = await context.env.DB.prepare(`SELECT * FROM support_conversations
    WHERE platform_id=? AND external_conversation_id=? LIMIT 1`)
    .bind(auth.platform.id, externalConversationId).first();
  if (existing) {
    await context.env.DB.prepare(`UPDATE support_conversations SET current_page=?,page_title=?,last_activity_at=?,updated_at=? WHERE id=?`)
      .bind(cleanText(body.pagePath, 500) || existing.current_page, cleanText(body.pageTitle, 200) || existing.page_title, now, now, existing.id).run();
    return json({
      created: false,
      conversation: {
        id: existing.id,
        reference: existing.conversation_reference,
        status: existing.status,
        handlingMode: existing.handling_mode,
        identityStatus: existing.identity_status
      },
      branch: publicBranchConfig(settings)
    });
  }

  const id = crypto.randomUUID();
  const reference = supportReference();
  const visitorReference = cleanText(body.visitorReference, 200);
  const verifiedEmail = validEmail(identity.verifiedEmail || identity.email) ? String(identity.verifiedEmail || identity.email).toLowerCase() : null;
  const identityStatus = resolved.customer && authenticated ? "verified" : resolved.customer ? "linked" : authenticated ? "reconciliation_required" : "anonymous";
  const status = settings.ai_enabled ? "ai_handling" : settings.human_takeover_enabled ? "human_assistance_requested" : "awaiting_customer";
  const handlingMode = settings.ai_enabled ? "ai" : settings.human_takeover_enabled ? "human_pending" : "paused";

  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO support_conversations
      (id,conversation_reference,platform_id,customer_id,platform_account_id,external_conversation_id,
       visitor_reference_hash,status,handling_mode,category,priority,current_page,page_title,authenticated,
       identity_status,verified_email_snapshot,display_name_snapshot,customer_number_snapshot,
       service_context_json,safe_support_flags_json,opened_at,last_activity_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        id, reference, auth.platform.id, resolved.customer?.id || null, resolved.platformAccountId || null,
        externalConversationId, visitorReference ? await sha256(visitorReference) : null, status, handlingMode,
        cleanText(body.category || "general", 80).toLowerCase(),
        PRIORITIES.has(cleanText(body.priority, 20).toLowerCase()) ? cleanText(body.priority, 20).toLowerCase() : "normal",
        cleanText(body.pagePath, 500) || null, cleanText(body.pageTitle, 200) || null, authenticated ? 1 : 0,
        identityStatus, verifiedEmail, cleanText(identity.displayName || identity.name, 160) || resolved.customer?.display_name || null,
        resolved.customer?.customer_number || cleanText(identity.customerNumber || identity.ucn, 40) || null,
        jsonValue(safeObject(body.serviceContext)), jsonValue(safeObject(body.safeSupportFlags)), now, now, now, now
      ),
    context.env.DB.prepare(`INSERT INTO support_conversation_events
      (id,conversation_id,event_type,actor_type,actor_id,metadata_json,occurred_at)
      VALUES (?,?,'conversation.opened','platform',?,?,?)`)
      .bind(crypto.randomUUID(), id, auth.platform.id, jsonValue({ authenticated, identityStatus, pagePath: cleanText(body.pagePath, 500) }), now)
  ]);

  await platformAudit(context.env, auth.platform, "support.conversation.open", "support_conversation", id, {
    label: "Customer support conversation opened",
    reference,
    customerId: resolved.customer?.id || null,
    requestId: context.data?.requestId,
    metadata: { identityStatus, authenticated }
  });

  return json({
    created: true,
    conversation: { id, reference, status, handlingMode, identityStatus },
    branch: publicBranchConfig(settings)
  }, 201);
}

async function addMessage(context, auth, conversationReference) {
  const conversation = await findConversation(context.env, auth.platform.id, conversationReference);
  if (!conversation) return error("SUPPORT_CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
  let body;
  try { body = await readJson(context.request, 40_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const senderType = cleanText(body.senderType || "customer", 20).toLowerCase();
  const messageBody = cleanText(body.body || body.message, 8000);
  const externalMessageId = cleanText(body.externalMessageId, 180) || null;
  if (!PLATFORM_SENDERS.has(senderType) || !messageBody) {
    return error("INVALID_SUPPORT_MESSAGE", "A valid customer, AI or system message is required.");
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await context.env.DB.prepare(`INSERT INTO support_messages
    (id,conversation_id,external_message_id,sender_type,sender_id,sender_name,body,visibility,delivery_status,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,'customer','accepted',?,?)
    ON CONFLICT(conversation_id,external_message_id) DO NOTHING`)
    .bind(id, conversation.id, externalMessageId, senderType, auth.platform.id,
      cleanText(body.senderName, 120) || (senderType === "ai" ? "Support Assistant" : null),
      messageBody, jsonValue(safeObject(body.metadata)), now).run();

  const timeColumn = senderType === "customer" ? "last_customer_message_at" : senderType === "ai" ? "last_ai_message_at" : null;
  if (timeColumn) {
    await context.env.DB.prepare(`UPDATE support_conversations SET ${timeColumn}=?,last_activity_at=?,updated_at=? WHERE id=?`)
      .bind(now, now, now, conversation.id).run();
  } else {
    await context.env.DB.prepare("UPDATE support_conversations SET last_activity_at=?,updated_at=? WHERE id=?")
      .bind(now, now, conversation.id).run();
  }

  return json({ accepted: true, messageId: id, conversationId: conversation.id }, 202);
}

async function recordEvent(context, auth, conversationReference) {
  const conversation = await findConversation(context.env, auth.platform.id, conversationReference);
  if (!conversation) return error("SUPPORT_CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
  let body;
  try { body = await readJson(context.request, 24_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const eventType = cleanText(body.eventType || body.event, 60).toLowerCase();
  if (!EVENTS.has(eventType)) return error("INVALID_SUPPORT_EVENT", "The support event is not recognised.");
  const now = new Date().toISOString();
  let status = conversation.status;
  let handlingMode = conversation.handling_mode;
  let closedAt = conversation.closed_at;
  if (eventType === "close") { status = "closed"; handlingMode = "paused"; closedAt = now; }
  if (eventType === "reopen") { status = "human_assistance_requested"; handlingMode = "human_pending"; closedAt = null; }
  if (eventType === "request_human") { status = "human_assistance_requested"; handlingMode = "human_pending"; }

  const metadata = safeObject({ ...body.metadata, pagePath: body.pagePath, consentType: body.consentType, consentStatus: body.consentStatus });
  const statements = [
    context.env.DB.prepare(`INSERT INTO support_conversation_events
      (id,conversation_id,event_type,actor_type,actor_id,metadata_json,occurred_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), conversation.id, `conversation.${eventType}`, "platform", auth.platform.id, jsonValue(metadata), now),
    context.env.DB.prepare(`UPDATE support_conversations SET status=?,handling_mode=?,current_page=COALESCE(?,current_page),
      last_activity_at=?,closed_at=?,updated_at=? WHERE id=?`)
      .bind(status, handlingMode, cleanText(body.pagePath, 500) || null, now, closedAt, now, conversation.id)
  ];
  if (eventType === "consent_recorded") {
    const consentType = cleanText(body.consentType, 80);
    const consentStatus = cleanText(body.consentStatus, 40);
    if (!consentType || !consentStatus) return error("INVALID_SUPPORT_CONSENT", "Consent type and status are required.");
    statements.push(context.env.DB.prepare(`INSERT INTO support_consents
      (id,conversation_id,customer_id,consent_type,consent_status,notice_version,evidence_json,recorded_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), conversation.id, conversation.customer_id, consentType, consentStatus,
        cleanText(body.noticeVersion, 80) || null, jsonValue(safeObject(body.evidence)), now));
  }
  await context.env.DB.batch(statements);
  return json({ accepted: true, status, handlingMode, updatedAt: now }, 202);
}

function caseTypeFor(category) {
  const value = String(category || "").toLowerCase();
  if (value.includes("complaint")) return "complaint";
  if (value.includes("data") || value.includes("privacy") || value.includes("sar")) return "data_protection";
  if (value.includes("safeguard") || value.includes("young person") || value.includes("child")) return "safeguarding";
  if (value.includes("security") || value.includes("fraud") || value.includes("compromise")) return "security";
  if (value.includes("account") || value.includes("sign-in") || value.includes("login")) return "account_recovery";
  return "general";
}

async function escalateConversation(context, auth, conversationReference) {
  const conversation = await findConversation(context.env, auth.platform.id, conversationReference);
  if (!conversation) return error("SUPPORT_CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
  if (conversation.case_id) {
    const linked = await context.env.DB.prepare("SELECT id,case_reference FROM cases WHERE id=?").bind(conversation.case_id).first();
    return json({ created: false, caseId: linked?.id || conversation.case_id, caseReference: linked?.case_reference || null });
  }
  let body;
  try { body = await readJson(context.request, 48_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  await ensureOperationsReady(context.env);
  const category = cleanText(body.category || conversation.category, 80);
  const caseType = caseTypeFor(category);
  const priority = PRIORITIES.has(cleanText(body.priority || conversation.priority, 20).toLowerCase())
    ? cleanText(body.priority || conversation.priority, 20).toLowerCase() : "normal";
  const title = cleanText(body.title || `${auth.platform.name} customer support escalation`, 160);
  const summary = cleanText(body.summary || body.description || "Customer support requires Head Office assistance.", 4000);
  if (title.length < 3 || summary.length < 5) return error("INVALID_SUPPORT_ESCALATION", "A title and summary are required.");

  const now = new Date().toISOString();
  const caseId = crypto.randomUUID();
  const caseReference = await allocateCaseReference(context.env, caseType);
  const dueAt = await defaultDueDate(context.env, priority);
  const transcript = await context.env.DB.prepare(`SELECT sender_type,sender_name,body,created_at
    FROM support_messages WHERE conversation_id=? AND visibility='customer' ORDER BY created_at,id LIMIT 500`)
    .bind(conversation.id).all();
  const transcriptText = transcript.results.map(row =>
    `[${row.created_at}] ${row.sender_name || row.sender_type}: ${row.body}`).join("\n").slice(0, 20000);

  const statements = [
    context.env.DB.prepare(`INSERT INTO cases
      (id,case_reference,customer_id,platform_id,case_type,title,description,priority,status,assigned_staff_id,due_at,opened_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?, 'open',NULL,?,?,?,?)`)
      .bind(caseId, caseReference, conversation.customer_id, auth.platform.id, caseType, title,
        `${summary}\n\nConversation: ${conversation.conversation_reference}\nCurrent page: ${conversation.current_page || "Not supplied"}\n\nTranscript:\n${transcriptText}`.slice(0, 24000),
        priority, dueAt, now, now, now),
    context.env.DB.prepare(`INSERT INTO case_notes
      (id,case_id,note_type,body,visibility,created_by,created_at)
      VALUES (?,?,'system',?,'case_team',?,?)`)
      .bind(crypto.randomUUID(), caseId, `Case created from ${auth.platform.name} support conversation ${conversation.conversation_reference}.`, auth.platform.id, now),
    context.env.DB.prepare(`UPDATE support_conversations SET case_id=?,status='escalated',handling_mode='human_pending',
      category=?,priority=?,last_activity_at=?,updated_at=? WHERE id=?`)
      .bind(caseId, category.toLowerCase() || conversation.category, priority, now, now, conversation.id),
    context.env.DB.prepare(`INSERT INTO support_conversation_events
      (id,conversation_id,event_type,actor_type,actor_id,metadata_json,occurred_at)
      VALUES (?,?,'conversation.escalated','platform',?,?,?)`)
      .bind(crypto.randomUUID(), conversation.id, auth.platform.id, jsonValue({ caseId, caseReference, caseType, priority }), now)
  ];
  if (caseType === "complaint") {
    statements.push(context.env.DB.prepare(`INSERT INTO complaint_records
      (id,case_id,complaint_stage,received_at,acknowledgement_due_at,final_response_due_at,created_at,updated_at)
      VALUES (?,?,'received',?,?,?,?,?)`)
      .bind(crypto.randomUUID(), caseId, now, new Date(Date.parse(now) + 48 * 60 * 60_000).toISOString(),
        new Date(Date.parse(now) + 20 * 24 * 60 * 60_000).toISOString(), now, now));
  }
  await context.env.DB.batch(statements);
  await platformAudit(context.env, auth.platform, "support.conversation.escalate", "support_conversation", conversation.id, {
    label: "Support conversation escalated to Head Office case",
    reference: conversation.conversation_reference,
    customerId: conversation.customer_id,
    requestId: context.data?.requestId,
    metadata: { caseId, caseReference, caseType, priority }
  });
  return json({ created: true, caseId, caseReference, caseType, priority }, 201);
}

export const onRequestGet = async context => {
  const auth = await authenticate(context, "support:read");
  if (auth.response) return auth.response;
  const route = segments(context.params.path);
  if (route.length === 1 && route[0] === "config") return getConfig(context, auth);
  if (route.length === 1 && route[0] === "knowledge") return getKnowledge(context, auth);
  if (route.length === 3 && route[0] === "conversations" && route[2] === "messages") {
    return listMessages(context, auth, route[1]);
  }
  return error("SUPPORT_ROUTE_NOT_FOUND", "The support API route was not found.", 404);
};

export const onRequestPost = async context => {
  const auth = await authenticate(context, "support:write");
  if (auth.response) return auth.response;
  const route = segments(context.params.path);
  if (route.length === 1 && route[0] === "conversations") return startConversation(context, auth);
  if (route.length === 3 && route[0] === "conversations" && route[2] === "messages") {
    return addMessage(context, auth, route[1]);
  }
  if (route.length === 3 && route[0] === "conversations" && route[2] === "events") {
    return recordEvent(context, auth, route[1]);
  }
  if (route.length === 3 && route[0] === "conversations" && route[2] === "escalate") {
    return escalateConversation(context, auth, route[1]);
  }
  return error("SUPPORT_ROUTE_NOT_FOUND", "The support API route was not found.", 404);
};
