import { audit, cleanText, error, json, readJson } from "../../_shared.js";
import { hasPermission, requirePermission } from "../../_operations.js";
import { ensureSupportCentreSchema, jsonValue, safeObject } from "../../_support-centre-schema.js";

const STATUSES = new Set([
  "ai_handling", "awaiting_customer", "human_assistance_requested", "assigned",
  "under_investigation", "resolved", "closed", "escalated", "security_review_required"
]);
const HANDLING_MODES = new Set(["ai", "human_pending", "human", "hybrid", "paused"]);
const RESTRICTED_CATEGORIES = new Set(["data_protection", "safeguarding"]);

function segments(value) {
  if (Array.isArray(value)) return value.flatMap(item => String(item).split("/")).filter(Boolean);
  return String(value || "").split("/").filter(Boolean);
}

function rolesOf(auth) {
  return new Set((auth.authorisation?.roles || []).map(value => String(value).toUpperCase()));
}

function isPrincipal(auth) {
  const roles = rolesOf(auth);
  return hasPermission(auth.authorisation, "*") || roles.has("HEAD_OFFICE_PRINCIPAL") || roles.has("SYSTEM_ADMINISTRATOR");
}

function categoryPermitted(auth, category) {
  const value = String(category || "general").toLowerCase();
  if (isPrincipal(auth)) return true;
  if (value === "data_protection") return hasPermission(auth.authorisation, "data_protection:*");
  if (value === "safeguarding") return hasPermission(auth.authorisation, "safeguarding:*");
  if (hasPermission(auth.authorisation, "communications:read") || hasPermission(auth.authorisation, "communications:write")) return true;
  return false;
}

async function branchAccess(env, auth, platformId) {
  if (isPrincipal(auth)) return { can_read: 1, can_reply: 1, can_takeover: 1, can_configure: 1, elevated: true };
  const roles = rolesOf(auth);
  if (roles.has("HEAD_OFFICE_OPERATIONS")) return { can_read: 1, can_reply: 1, can_takeover: 1, can_configure: 0, elevated: true };
  if (roles.has("SECURITY_OFFICER")) return { can_read: 1, can_reply: 1, can_takeover: 1, can_configure: 0, elevated: true };
  const row = await env.DB.prepare(`SELECT can_read,can_reply,can_takeover,can_configure
    FROM support_staff_branch_access WHERE staff_id=? AND platform_id=? LIMIT 1`)
    .bind(auth.session.sub, platformId).first();
  return row || { can_read: 0, can_reply: 0, can_takeover: 0, can_configure: 0, elevated: false };
}

async function findConversation(env, reference) {
  const value = cleanText(reference, 180);
  if (!value) return null;
  return env.DB.prepare(`SELECT c.*,p.name platform_name,p.code platform_code,u.display_name customer_name,
      u.verified_email customer_email,u.customer_number,s.display_name assigned_staff_name,k.case_reference
    FROM support_conversations c
    JOIN platforms p ON p.id=c.platform_id
    LEFT JOIN customers u ON u.id=c.customer_id
    LEFT JOIN staff_members s ON s.id=c.assigned_staff_id
    LEFT JOIN cases k ON k.id=c.case_id
    WHERE c.id=? OR c.conversation_reference=? LIMIT 1`).bind(value, value).first();
}

async function authoriseConversation(env, auth, conversation, capability = "can_read") {
  if (!conversation) return { response: error("SUPPORT_CONVERSATION_NOT_FOUND", "The conversation was not found.", 404) };
  if (!categoryPermitted(auth, conversation.category)) {
    return { response: error("SUPPORT_CONVERSATION_ACCESS_DENIED", "You are not authorised for this restricted conversation.", 403) };
  }
  const access = await branchAccess(env, auth, conversation.platform_id);
  if (!access[capability]) {
    return { response: error("SUPPORT_BRANCH_ACCESS_DENIED", "You are not authorised for this support branch.", 403) };
  }
  return { access };
}

function conversationSummary(row) {
  return {
    id: row.id,
    reference: row.conversation_reference,
    platformId: row.platform_id,
    platformName: row.platform_name,
    platformCode: row.platform_code,
    customerId: row.customer_id,
    customerNumber: row.customer_number || row.customer_number_snapshot,
    customerName: row.customer_name || row.display_name_snapshot || "Anonymous visitor",
    verifiedEmail: row.customer_email || row.verified_email_snapshot,
    status: row.status,
    handlingMode: row.handling_mode,
    category: row.category,
    priority: row.priority,
    currentPage: row.current_page,
    authenticated: Boolean(row.authenticated),
    identityStatus: row.identity_status,
    assignedStaffId: row.assigned_staff_id,
    assignedStaffName: row.assigned_staff_name,
    caseId: row.case_id,
    caseReference: row.case_reference,
    openedAt: row.opened_at,
    lastActivityAt: row.last_activity_at,
    updatedAt: row.updated_at
  };
}

async function listConversations(context, auth) {
  const url = new URL(context.request.url);
  const query = cleanText(url.searchParams.get("q") || "", 100).toLowerCase();
  const status = cleanText(url.searchParams.get("status") || "", 60).toLowerCase();
  const platformId = cleanText(url.searchParams.get("platformId") || "", 120);
  const result = await context.env.DB.prepare(`SELECT c.*,p.name platform_name,p.code platform_code,
      u.display_name customer_name,u.verified_email customer_email,u.customer_number,
      s.display_name assigned_staff_name,k.case_reference
    FROM support_conversations c
    JOIN platforms p ON p.id=c.platform_id
    LEFT JOIN customers u ON u.id=c.customer_id
    LEFT JOIN staff_members s ON s.id=c.assigned_staff_id
    LEFT JOIN cases k ON k.id=c.case_id
    WHERE (?='' OR c.status=?) AND (?='' OR c.platform_id=?)
    ORDER BY CASE c.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      c.last_activity_at DESC LIMIT 300`)
    .bind(status, status, platformId, platformId).all();

  const output = [];
  const accessCache = new Map();
  for (const row of result.results) {
    if (!categoryPermitted(auth, row.category)) continue;
    if (!accessCache.has(row.platform_id)) accessCache.set(row.platform_id, await branchAccess(context.env, auth, row.platform_id));
    if (!accessCache.get(row.platform_id).can_read) continue;
    const summary = conversationSummary(row);
    if (query) {
      const haystack = [summary.reference, summary.platformName, summary.customerNumber, summary.customerName,
        summary.verifiedEmail, summary.category, summary.currentPage, summary.caseReference].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(query)) continue;
    }
    output.push(summary);
  }
  return json({ conversations: output, count: output.length });
}

async function getConversation(context, auth, reference) {
  const conversation = await findConversation(context.env, reference);
  const authorised = await authoriseConversation(context.env, auth, conversation, "can_read");
  if (authorised.response) return authorised.response;
  const [messages, events, providerEscalations] = await context.env.DB.batch([
    context.env.DB.prepare(`SELECT id,external_message_id,sender_type,sender_id,sender_name,body,visibility,
      delivery_status,metadata_json,created_at FROM support_messages WHERE conversation_id=? ORDER BY created_at,id LIMIT 1000`)
      .bind(conversation.id),
    context.env.DB.prepare(`SELECT id,event_type,actor_type,actor_id,metadata_json,occurred_at
      FROM support_conversation_events WHERE conversation_id=? ORDER BY occurred_at DESC LIMIT 250`).bind(conversation.id),
    context.env.DB.prepare(`SELECT id,provider_name,provider_reference,status,summary,sent_at,response_due_at,
      response_received_at,customer_updated_at,created_at,updated_at
      FROM support_provider_escalations WHERE conversation_id=? ORDER BY created_at DESC`).bind(conversation.id)
  ]);
  await audit(context.env, auth.session, "support.conversation.read", "support_conversation", conversation.id, {
    label: "Support conversation opened",
    reference: conversation.conversation_reference,
    customerId: conversation.customer_id,
    caseId: conversation.case_id,
    requestId: context.data?.requestId,
    metadata: { platformId: conversation.platform_id }
  });
  return json({
    conversation: conversationSummary(conversation),
    serviceContext: (() => { try { return JSON.parse(conversation.service_context_json || "{}"); } catch { return {}; } })(),
    safeSupportFlags: (() => { try { return JSON.parse(conversation.safe_support_flags_json || "{}"); } catch { return {}; } })(),
    permissions: authorised.access,
    messages: messages.results.map(row => ({
      id: row.id,
      externalMessageId: row.external_message_id,
      senderType: row.sender_type,
      senderId: row.sender_id,
      senderName: row.sender_name,
      body: row.body,
      visibility: row.visibility,
      deliveryStatus: row.delivery_status,
      metadata: (() => { try { return JSON.parse(row.metadata_json || "{}"); } catch { return {}; } })(),
      createdAt: row.created_at
    })),
    events: events.results.map(row => ({
      id: row.id,
      eventType: row.event_type,
      actorType: row.actor_type,
      actorId: row.actor_id,
      metadata: (() => { try { return JSON.parse(row.metadata_json || "{}"); } catch { return {}; } })(),
      occurredAt: row.occurred_at
    })),
    providerEscalations: providerEscalations.results
  });
}

async function addStaffMessage(context, auth, reference) {
  const conversation = await findConversation(context.env, reference);
  const authorised = await authoriseConversation(context.env, auth, conversation, "can_reply");
  if (authorised.response) return authorised.response;
  let body;
  try { body = await readJson(context.request, 40_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const messageBody = cleanText(body.body || body.message, 8000);
  const visibility = body.visibility === "internal" ? "internal" : "customer";
  if (!messageBody) return error("INVALID_SUPPORT_MESSAGE", "Enter a message.");
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO support_messages
      (id,conversation_id,sender_type,sender_id,sender_name,body,visibility,delivery_status,metadata_json,created_at)
      VALUES (?,?,'staff',?,?,?,?, 'accepted',?,?)`)
      .bind(id, conversation.id, auth.session.sub, auth.session.displayName, messageBody, visibility,
        jsonValue(safeObject(body.metadata)), now),
    context.env.DB.prepare(`UPDATE support_conversations SET assigned_staff_id=COALESCE(assigned_staff_id,?),
      status=CASE WHEN ?='customer' THEN 'awaiting_customer' ELSE status END,
      handling_mode=CASE WHEN ?='customer' THEN 'human' ELSE handling_mode END,
      last_staff_message_at=?,last_activity_at=?,updated_at=? WHERE id=?`)
      .bind(auth.session.sub, visibility, visibility, now, now, now, conversation.id),
    context.env.DB.prepare(`INSERT INTO support_conversation_events
      (id,conversation_id,event_type,actor_type,actor_id,metadata_json,occurred_at)
      VALUES (?,?,'conversation.staff_message','staff',?,?,?)`)
      .bind(crypto.randomUUID(), conversation.id, auth.session.sub, jsonValue({ visibility }), now)
  ]);
  await audit(context.env, auth.session, visibility === "internal" ? "support.note.create" : "support.message.send",
    "support_conversation", conversation.id, {
      label: visibility === "internal" ? "Restricted support note added" : "Customer support reply sent",
      reference: conversation.conversation_reference,
      customerId: conversation.customer_id,
      caseId: conversation.case_id,
      requestId: context.data?.requestId,
      metadata: { platformId: conversation.platform_id, visibility }
    });
  return json({ accepted: true, messageId: id, visibility, createdAt: now }, 201);
}

async function takeOver(context, auth, reference) {
  const conversation = await findConversation(context.env, reference);
  const authorised = await authoriseConversation(context.env, auth, conversation, "can_takeover");
  if (authorised.response) return authorised.response;
  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE support_conversations SET assigned_staff_id=?,status='assigned',handling_mode='human',
      last_activity_at=?,updated_at=? WHERE id=?`).bind(auth.session.sub, now, now, conversation.id),
    context.env.DB.prepare(`INSERT INTO support_conversation_events
      (id,conversation_id,event_type,actor_type,actor_id,metadata_json,occurred_at)
      VALUES (?,?,'conversation.taken_over','staff',?,'{}',?)`)
      .bind(crypto.randomUUID(), conversation.id, auth.session.sub, now)
  ]);
  await audit(context.env, auth.session, "support.conversation.takeover", "support_conversation", conversation.id, {
    label: "Support conversation taken over",
    reference: conversation.conversation_reference,
    customerId: conversation.customer_id,
    caseId: conversation.case_id,
    requestId: context.data?.requestId,
    metadata: { platformId: conversation.platform_id }
  });
  return json({ assigned: true, assignedStaffId: auth.session.sub, handlingMode: "human", status: "assigned", updatedAt: now });
}

async function updateStatus(context, auth, reference) {
  const conversation = await findConversation(context.env, reference);
  const authorised = await authoriseConversation(context.env, auth, conversation, "can_reply");
  if (authorised.response) return authorised.response;
  let body;
  try { body = await readJson(context.request, 20_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const status = cleanText(body.status, 60).toLowerCase();
  const handlingMode = cleanText(body.handlingMode || conversation.handling_mode, 30).toLowerCase();
  if (!STATUSES.has(status) || !HANDLING_MODES.has(handlingMode)) {
    return error("INVALID_SUPPORT_STATUS", "Select a valid conversation status and handling mode.");
  }
  const now = new Date().toISOString();
  const closedAt = status === "closed" ? now : null;
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE support_conversations SET status=?,handling_mode=?,closed_at=?,last_activity_at=?,updated_at=? WHERE id=?`)
      .bind(status, handlingMode, closedAt, now, now, conversation.id),
    context.env.DB.prepare(`INSERT INTO support_conversation_events
      (id,conversation_id,event_type,actor_type,actor_id,metadata_json,occurred_at)
      VALUES (?,?,'conversation.status_changed','staff',?,?,?)`)
      .bind(crypto.randomUUID(), conversation.id, auth.session.sub, jsonValue({ status, handlingMode }), now)
  ]);
  await audit(context.env, auth.session, "support.conversation.status", "support_conversation", conversation.id, {
    label: "Support conversation status changed",
    reference: conversation.conversation_reference,
    customerId: conversation.customer_id,
    caseId: conversation.case_id,
    requestId: context.data?.requestId,
    before: { status: conversation.status, handlingMode: conversation.handling_mode },
    after: { status, handlingMode },
    metadata: { platformId: conversation.platform_id }
  });
  return json({ status, handlingMode, updatedAt: now });
}

async function listBranches(context, auth) {
  const result = await context.env.DB.prepare(`SELECT p.id,p.code,p.name,p.status platform_status,b.*
    FROM platforms p LEFT JOIN support_branch_settings b ON b.platform_id=p.id ORDER BY p.name`).all();
  const branches = [];
  for (const row of result.results) {
    const access = await branchAccess(context.env, auth, row.id);
    if (!access.can_read && !access.can_configure) continue;
    branches.push({
      platformId: row.id,
      platformCode: row.code,
      platformName: row.name,
      platformStatus: row.platform_status,
      configured: Boolean(row.platform_id),
      assistantName: row.assistant_name || `${row.name} Support Assistant`,
      assistantEnabled: Boolean(row.assistant_enabled),
      aiEnabled: Boolean(row.ai_enabled),
      humanTakeoverEnabled: row.human_takeover_enabled == null ? true : Boolean(row.human_takeover_enabled),
      anonymousEnabled: row.anonymous_enabled == null ? true : Boolean(row.anonymous_enabled),
      maintenanceEnabled: Boolean(row.maintenance_enabled),
      maintenanceMessage: row.maintenance_message || "",
      emergencyNotice: row.emergency_notice || "",
      greeting: row.greeting || "",
      awayMessage: row.away_message || "",
      operatingHours: (() => { try { return JSON.parse(row.operating_hours_json || "{}"); } catch { return {}; } })(),
      appearance: (() => { try { return JSON.parse(row.appearance_json || "{}"); } catch { return {}; } })(),
      contactOptions: (() => { try { return JSON.parse(row.contact_options_json || "{}"); } catch { return {}; } })(),
      retentionDays: Number(row.retention_days || 365),
      permissions: access
    });
  }
  return json({ branches });
}

async function updateBranch(context, auth, platformId) {
  const access = await branchAccess(context.env, auth, platformId);
  if (!access.can_configure && !hasPermission(auth.authorisation, "configuration:write")) {
    return error("SUPPORT_BRANCH_CONFIGURATION_DENIED", "You are not authorised to configure this support branch.", 403);
  }
  const platform = await context.env.DB.prepare("SELECT id,name FROM platforms WHERE id=? LIMIT 1").bind(platformId).first();
  if (!platform) return error("PLATFORM_NOT_FOUND", "The connected platform was not found.", 404);
  let body;
  try { body = await readJson(context.request, 48_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const now = new Date().toISOString();
  const retentionDays = Math.max(30, Math.min(2555, Number(body.retentionDays || 365)));
  await context.env.DB.prepare(`INSERT INTO support_branch_settings
    (platform_id,assistant_name,assistant_enabled,ai_enabled,human_takeover_enabled,anonymous_enabled,
     maintenance_enabled,maintenance_message,emergency_notice,greeting,away_message,operating_hours_json,
     appearance_json,escalation_rules_json,contact_options_json,retention_days,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(platform_id) DO UPDATE SET assistant_name=excluded.assistant_name,
      assistant_enabled=excluded.assistant_enabled,ai_enabled=excluded.ai_enabled,
      human_takeover_enabled=excluded.human_takeover_enabled,anonymous_enabled=excluded.anonymous_enabled,
      maintenance_enabled=excluded.maintenance_enabled,maintenance_message=excluded.maintenance_message,
      emergency_notice=excluded.emergency_notice,greeting=excluded.greeting,away_message=excluded.away_message,
      operating_hours_json=excluded.operating_hours_json,appearance_json=excluded.appearance_json,
      escalation_rules_json=excluded.escalation_rules_json,contact_options_json=excluded.contact_options_json,
      retention_days=excluded.retention_days,updated_at=excluded.updated_at`)
    .bind(platformId, cleanText(body.assistantName, 120) || `${platform.name} Support Assistant`, body.assistantEnabled ? 1 : 0,
      body.aiEnabled ? 1 : 0, body.humanTakeoverEnabled === false ? 0 : 1, body.anonymousEnabled === false ? 0 : 1,
      body.maintenanceEnabled ? 1 : 0, cleanText(body.maintenanceMessage, 1000) || null,
      cleanText(body.emergencyNotice, 1000) || null, cleanText(body.greeting, 1000) || null,
      cleanText(body.awayMessage, 1000) || null, jsonValue(safeObject(body.operatingHours, 80)),
      jsonValue(safeObject(body.appearance, 80)), jsonValue(safeObject(body.escalationRules, 80)),
      jsonValue(safeObject(body.contactOptions, 80)), retentionDays, now, now).run();
  await audit(context.env, auth.session, "support.branch.configure", "platform", platformId, {
    label: "Customer support branch configuration changed",
    reference: platform.name,
    requestId: context.data?.requestId,
    after: {
      assistantEnabled: Boolean(body.assistantEnabled), aiEnabled: Boolean(body.aiEnabled),
      humanTakeoverEnabled: body.humanTakeoverEnabled !== false, anonymousEnabled: body.anonymousEnabled !== false,
      maintenanceEnabled: Boolean(body.maintenanceEnabled), retentionDays
    }
  });
  return json({ updated: true, platformId, updatedAt: now });
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "communications:read");
  if (auth.response) return auth.response;
  await ensureSupportCentreSchema(context.env);
  const route = segments(context.params.path);
  if (route.length === 1 && route[0] === "conversations") return listConversations(context, auth);
  if (route.length === 2 && route[0] === "conversations") return getConversation(context, auth, route[1]);
  if (route.length === 1 && route[0] === "branches") return listBranches(context, auth);
  return error("SUPPORT_CENTRE_ROUTE_NOT_FOUND", "The Customer Service Centre route was not found.", 404);
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "communications:write");
  if (auth.response) return auth.response;
  await ensureSupportCentreSchema(context.env);
  const route = segments(context.params.path);
  if (route.length === 3 && route[0] === "conversations" && route[2] === "messages") return addStaffMessage(context, auth, route[1]);
  if (route.length === 3 && route[0] === "conversations" && route[2] === "takeover") return takeOver(context, auth, route[1]);
  if (route.length === 3 && route[0] === "conversations" && route[2] === "status") return updateStatus(context, auth, route[1]);
  return error("SUPPORT_CENTRE_ROUTE_NOT_FOUND", "The Customer Service Centre route was not found.", 404);
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "configuration:write");
  if (auth.response) return auth.response;
  await ensureSupportCentreSchema(context.env);
  const route = segments(context.params.path);
  if (route.length === 2 && route[0] === "branches") return updateBranch(context, auth, route[1]);
  return error("SUPPORT_CENTRE_ROUTE_NOT_FOUND", "The Customer Service Centre route was not found.", 404);
};
