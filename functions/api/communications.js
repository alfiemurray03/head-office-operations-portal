import { audit, cleanNullableText, cleanText, error, json, normaliseDate, readJson } from "../_shared.js";
import { canAccessCaseType, caseAccessFlags, findCase, findCustomer, requirePermission } from "../_operations.js";

const DIRECTIONS = new Set(["inbound", "outbound", "internal"]);
const CHANNELS = new Set(["email", "telephone", "whatsapp", "letter", "web_form", "system"]);

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "communications:read");
  if (auth.response) return auth.response;
  const url = new URL(context.request.url);
  const query = cleanText(url.searchParams.get("q") || "", 100);
  const channel = cleanText(url.searchParams.get("channel") || "", 30);
  const direction = cleanText(url.searchParams.get("direction") || "", 30);
  const flags = caseAccessFlags(auth.authorisation);
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const result = await context.env.DB.prepare(`SELECT m.*,u.customer_number,u.display_name customer_name,c.case_reference,c.case_type
    FROM communications m LEFT JOIN customers u ON u.id=m.customer_id LEFT JOIN cases c ON c.id=m.case_id
    WHERE (?='' OR COALESCE(m.subject,'') LIKE ? ESCAPE '\\' OR m.summary LIKE ? ESCAPE '\\' OR COALESCE(u.customer_number,'') LIKE ? ESCAPE '\\' OR COALESCE(u.display_name,'') LIKE ? ESCAPE '\\')
      AND (?='' OR m.channel=?) AND (?='' OR m.direction=?)
      AND (?=1 OR COALESCE(c.case_type,'')!='data_protection') AND (?=1 OR COALESCE(c.case_type,'')!='safeguarding')
    ORDER BY m.occurred_at DESC LIMIT 200`)
    .bind(query, search, search, search, search, channel, channel, direction, direction, flags.dataProtection ? 1 : 0, flags.safeguarding ? 1 : 0).all();
  return json({ communications: result.results });
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "communications:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const customerReference = cleanNullableText(body.customerNumber || body.customerId, 100);
  const caseReference = cleanNullableText(body.caseReference || body.caseId, 100);
  const direction = cleanText(body.direction, 30);
  const channel = cleanText(body.channel, 30);
  const subject = cleanNullableText(body.subject, 200);
  const summary = cleanText(body.summary, 4000);
  const occurredAt = body.occurredAt ? normaliseDate(body.occurredAt) : new Date().toISOString();
  if (!DIRECTIONS.has(direction) || !CHANNELS.has(channel) || summary.length < 2 || !occurredAt) return error("INVALID_COMMUNICATION", "Complete the communication details.");
  const caseRecord = caseReference ? await findCase(context.env, caseReference) : null;
  if (caseReference && !caseRecord) return error("CASE_NOT_FOUND", "The linked Head Office case was not found.", 404);
  if (caseRecord && !canAccessCaseType(auth.authorisation, caseRecord.case_type, true)) return error("CASE_ACCESS_DENIED", "You are not authorised to record communications on this case.", 403);
  const customer = customerReference ? await findCustomer(context.env, customerReference) : (caseRecord?.customer_id ? await findCustomer(context.env, caseRecord.customer_id) : null);
  if (customerReference && !customer) return error("CUSTOMER_NOT_FOUND", "The universal customer record was not found.", 404);
  if (!customer && !caseRecord) return error("RECORD_LINK_REQUIRED", "Link the communication to a customer or Head Office case.");
  if (caseRecord?.customer_id && customer && caseRecord.customer_id !== customer.id) return error("CASE_CUSTOMER_MISMATCH", "The selected case belongs to a different customer.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [context.env.DB.prepare(`INSERT INTO communications
    (id,customer_id,case_id,direction,channel,subject,summary,external_message_id,occurred_at,recorded_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, customer?.id || null, caseRecord?.id || null, direction, channel, subject, summary, cleanNullableText(body.externalMessageId, 200), occurredAt, auth.session.sub, now)];
  if (customer) statements.push(context.env.DB.prepare("UPDATE customers SET last_activity_at=?,updated_at=? WHERE id=?").bind(occurredAt, now, customer.id));
  await context.env.DB.batch(statements);
  await audit(context.env, auth.session, "communication.recorded", "communication", id, {
    label: "Customer communication recorded",
    reference: caseRecord?.case_reference || customer?.customer_number || id,
    customerId: customer?.id || null,
    caseId: caseRecord?.id || null,
    requestId: context.data.requestId,
    after: { direction, channel, subject, occurredAt }
  });
  return json({ id }, 201);
};
