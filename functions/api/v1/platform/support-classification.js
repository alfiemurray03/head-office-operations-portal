import { cleanText, error, json, platformAudit, readJson, requirePlatform } from "../../../_shared.js";
import { ensureSupportCentreSchema, jsonValue, normaliseSupportCategory } from "../../../_support-centre-schema.js";

const RESTRICTED = new Set(["data_protection", "safeguarding", "security"]);
const PRIORITY_RANK = Object.freeze({ low: 1, normal: 2, high: 3, critical: 4 });

function hasScope(platform, required) {
  return platform.scopes.includes("support:*") || platform.scopes.includes(required);
}

function priority(value) {
  const cleaned = cleanText(value || "normal", 20).toLowerCase();
  return PRIORITY_RANK[cleaned] ? cleaned : "normal";
}

function nextCategory(existingValue, requestedValue) {
  const existing = normaliseSupportCategory(existingValue);
  const requested = normaliseSupportCategory(requestedValue);
  if (RESTRICTED.has(existing)) return existing;
  if (RESTRICTED.has(requested)) return requested;
  if (requested !== "general") return requested;
  return existing;
}

function nextPriority(existingValue, requestedValue) {
  const existing = priority(existingValue);
  const requested = priority(requestedValue);
  return PRIORITY_RANK[requested] > PRIORITY_RANK[existing] ? requested : existing;
}

export async function onRequestPost(context) {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth.response;
  if (!hasScope(auth.platform, "support:write")) {
    return error("INSUFFICIENT_PLATFORM_SCOPE", "The credential requires support:write.", 403);
  }
  await ensureSupportCentreSchema(context.env);

  let body;
  try {
    body = await readJson(context.request, 24_000);
  } catch (cause) {
    return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400);
  }

  const reference = cleanText(body.conversationId || body.conversationReference || body.externalConversationId || body.sessionId, 180);
  if (!reference) return error("SUPPORT_CONVERSATION_REQUIRED", "A conversation reference is required.");
  const conversation = await context.env.DB.prepare(`SELECT * FROM support_conversations
    WHERE platform_id=? AND (id=? OR conversation_reference=? OR external_conversation_id=?) LIMIT 1`)
    .bind(auth.platform.id, reference, reference, reference).first();
  if (!conversation) return error("SUPPORT_CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);

  const category = nextCategory(conversation.category, body.category);
  const supportPriority = nextPriority(conversation.priority, body.priority);
  const restricted = RESTRICTED.has(category);
  const status = restricted
    ? category === "security" ? "security_review_required" : "human_assistance_requested"
    : conversation.status;
  const handlingMode = restricted ? "human_pending" : conversation.handling_mode;
  const now = new Date().toISOString();

  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE support_conversations SET category=?,priority=?,status=?,handling_mode=?,
      last_activity_at=?,updated_at=? WHERE id=?`)
      .bind(category, supportPriority, status, handlingMode, now, now, conversation.id),
    context.env.DB.prepare(`INSERT INTO support_conversation_events
      (id,conversation_id,event_type,actor_type,actor_id,metadata_json,occurred_at)
      VALUES (?,?,'conversation.classified','platform',?,?,?)`)
      .bind(crypto.randomUUID(), conversation.id, auth.platform.id, jsonValue({
        previousCategory: normaliseSupportCategory(conversation.category),
        category,
        previousPriority: priority(conversation.priority),
        priority: supportPriority,
        restricted
      }), now)
  ]);

  await platformAudit(context.env, auth.platform, "support.conversation.classify", "support_conversation", conversation.id, {
    label: restricted ? "Support conversation promoted to restricted handling" : "Support conversation classified",
    reference: conversation.conversation_reference,
    customerId: conversation.customer_id,
    requestId: context.data?.requestId,
    before: { category: normaliseSupportCategory(conversation.category), priority: priority(conversation.priority), status: conversation.status, handlingMode: conversation.handling_mode },
    after: { category, priority: supportPriority, status, handlingMode },
    metadata: { restricted }
  });

  return json({
    conversationId: conversation.id,
    reference: conversation.conversation_reference,
    category,
    priority: supportPriority,
    status,
    handlingMode,
    restricted,
    updatedAt: now
  });
}

export async function onRequest(context) {
  if (context.request.method !== "POST") return error("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  return onRequestPost(context);
}
