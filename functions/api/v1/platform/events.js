import { cleanText, error, json, readJson, requirePlatform } from "../../../_shared.js";
import { ensureCentralPlatformSchema } from "../../../_central-schema.js";
import { ingestSecurityEvent } from "../../../_risk-engine.js";

const ACTOR_TYPES = new Set(["customer","administrator","head_office","system","integration"]);
const OUTCOMES = new Set(["success","failure","pending","denied","completed","skipped"]);
const CATEGORIES = new Set(["customer_activity","account_lifecycle","profile_management","administrative_action","security_event","synchronisation_event","head_office_instruction"]);

function safeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0,40)) {
    const key = cleanText(rawKey,80);
    if (!key || /secret|token|password|credential|authorization|cookie/i.test(key)) continue;
    if (["string","number","boolean"].includes(typeof rawValue) || rawValue === null) {
      output[key] = typeof rawValue === "string" ? cleanText(rawValue,500) : rawValue;
    }
  }
  return output;
}

function titleFor(type) {
  return type.split(/[._-]/).filter(Boolean).map(part=>part[0]?.toUpperCase()+part.slice(1)).join(" ");
}

export const onRequestPost = async context => {
  const auth = await requirePlatform(context,[]);
  if (auth.response) return auth.response;
  if (!auth.platform.scopes.includes("events:write") && !auth.platform.scopes.includes("customers:write")) {
    return error("INSUFFICIENT_PLATFORM_SCOPE","The credential cannot submit customer events.",403);
  }
  await ensureCentralPlatformSchema(context.env);
  let body;
  try { body = await readJson(context.request,64_000); }
  catch (cause) { return error(cause.code||"INVALID_REQUEST",cause.message,cause.status||400); }

  const eventId = cleanText(body.eventId||body.externalEventId,160);
  const eventType = cleanText(body.eventType,120).toLowerCase();
  const platformAccountId = cleanText(body.platformAccountId||body.platformCustomerId,160);
  const platformPersonId = cleanText(body.platformPersonId||body.profileId,160)||null;
  const centralCustomerId = cleanText(body.centralCustomerId||body.customerId,100)||null;
  const customerNumber = cleanText(body.customerNumber||body.ucn,40)||null;
  const category = cleanText(body.category||"customer_activity",60).toLowerCase();
  const actorType = cleanText(body.actorType||"system",40).toLowerCase();
  const outcome = cleanText(body.outcome||"success",30).toLowerCase();
  const occurredAt = body.occurredAt && !Number.isNaN(Date.parse(body.occurredAt)) ? new Date(body.occurredAt).toISOString() : null;
  if (!eventId || !/^[a-z0-9_-]+[.][a-z0-9_.-]+$/.test(eventType) || !platformAccountId || !occurredAt
    || !CATEGORIES.has(category) || !ACTOR_TYPES.has(actorType) || !OUTCOMES.has(outcome)) {
    return error("INVALID_PLATFORM_EVENT","A valid event ID, namespaced type, platform account, timestamp, category, actor and outcome are required.");
  }

  const existing = await context.env.DB.prepare(`SELECT id,customer_id FROM platform_customer_event_receipts
    WHERE platform_id=? AND external_event_id=?`).bind(auth.platform.id,eventId).first();
  if (existing) return json({accepted:true,duplicate:true,eventId,customerId:existing.customer_id});

  const link = await context.env.DB.prepare(`SELECT a.id,a.customer_id,a.external_account_id,a.external_person_id,
      c.customer_number FROM customer_platform_accounts a JOIN customers c ON c.id=a.customer_id
    WHERE a.platform_id=? AND a.external_account_id=? LIMIT 1`).bind(auth.platform.id,platformAccountId).first();
  if (!link) return error("PLATFORM_ACCOUNT_NOT_LINKED","The platform account is not linked to a central customer.",409);
  if ((centralCustomerId && centralCustomerId!==link.customer_id) || (customerNumber && customerNumber!==link.customer_number)
    || (platformPersonId && link.external_person_id && platformPersonId!==link.external_person_id)) {
    return error("CUSTOMER_EVENT_CORRELATION_MISMATCH","The event identifiers do not match the authoritative platform-account link.",409);
  }

  const now = new Date().toISOString();
  const metadata = safeMetadata(body.metadata||body.data||body.attributes);
  const receiptId = crypto.randomUUID();
  const timelineId = crypto.randomUUID();
  const targetType = cleanText(body.targetType,80)||null;
  const targetReference = cleanText(body.targetReference,160)||platformPersonId||platformAccountId;
  const correlationId = cleanText(body.correlationId||body.requestId,160)||null;
  const actorIdentifier = cleanText(body.actorIdentifier,160)||null;
  const title = cleanText(body.description,240)||titleFor(eventType);
  const summary = cleanText(body.summary,1000)||`${auth.platform.name} reported ${title.toLowerCase()}.`;
  const showInTimeline = body.displayInTimeline !== false;
  const statements = [context.env.DB.prepare(`INSERT INTO platform_customer_event_receipts
    (id,platform_id,external_event_id,customer_id,platform_account_link_id,event_type,event_category,
     actor_type,actor_identifier,outcome,target_type,target_reference,correlation_id,occurred_at,received_at,safe_metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(receiptId,auth.platform.id,eventId,link.customer_id,link.id,eventType,
      category,actorType,actorIdentifier,outcome,targetType,targetReference,correlationId,occurredAt,now,JSON.stringify(metadata))];
  if (showInTimeline) statements.push(context.env.DB.prepare(`INSERT INTO customer_timeline_events
    (id,customer_id,platform_id,event_type,event_category,title,summary,occurred_at,source_reference,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(timelineId,link.customer_id,auth.platform.id,eventType,category,title,summary,
      occurredAt,eventId,JSON.stringify({...metadata,sourcePlatform:"Profile Centre",actorType,actorIdentifier,outcome,
        targetType,targetReference,platformAccountId,platformPersonId,correlationId})));
  try { await context.env.DB.batch(statements); }
  catch (cause) {
    if (/UNIQUE|constraint/i.test(String(cause))) return json({accepted:true,duplicate:true,eventId,customerId:link.customer_id});
    throw cause;
  }

  let security = null;
  if (category === "security_event") {
    security = await ingestSecurityEvent(context.env,{externalEventId:eventId,eventType,customerId:link.customer_id,
      occurredAt,category:"authentication",attributes:{...metadata,outcome,actorType},platformId:auth.platform.id},
      {type:"platform",id:auth.platform.id,name:auth.platform.name,platformId:auth.platform.id});
  }
  return json({accepted:true,duplicate:false,eventId,customerId:link.customer_id,timelineRecorded:showInTimeline,security},202);
};
