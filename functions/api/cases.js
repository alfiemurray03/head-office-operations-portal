import { audit, cleanNullableText, cleanText, error, json, normaliseDate, readJson } from "../_shared.js";
import { allocateCaseReference, canAccessCaseType, caseAccessFlags, CASE_PRIORITIES, CASE_TYPES, defaultDueDate, findCustomer, requirePermission } from "../_operations.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "cases:read");
  if (auth.response) return auth.response;
  const url = new URL(context.request.url);
  const query = cleanText(url.searchParams.get("q") || "", 100);
  const caseType = cleanText(url.searchParams.get("type") || "", 40);
  const status = cleanText(url.searchParams.get("status") || "", 40);
  const priority = cleanText(url.searchParams.get("priority") || "", 20);
  if (caseType && (!CASE_TYPES.has(caseType) || !canAccessCaseType(auth.authorisation, caseType))) return error("CASE_ACCESS_DENIED", "You are not authorised to view that case queue.", 403);
  const flags = caseAccessFlags(auth.authorisation);
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const result = await context.env.DB.prepare(`SELECT c.id,c.case_reference,c.title,c.case_type,c.priority,c.status,c.due_at,c.opened_at,c.updated_at,
      u.customer_number,u.display_name customer_name,s.display_name assigned_staff_name
    FROM cases c LEFT JOIN customers u ON u.id=c.customer_id LEFT JOIN staff_members s ON s.id=c.assigned_staff_id
    WHERE (?='' OR c.case_reference LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\' OR COALESCE(u.customer_number,'') LIKE ? ESCAPE '\\' OR COALESCE(u.display_name,'') LIKE ? ESCAPE '\\')
      AND (?='' OR c.case_type=?) AND (?='' OR c.status=?) AND (?='' OR c.priority=?)
      AND (?=1 OR c.case_type!='data_protection') AND (?=1 OR c.case_type!='safeguarding')
    ORDER BY CASE c.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
      CASE WHEN c.due_at IS NULL THEN 1 ELSE 0 END,c.due_at,c.created_at DESC LIMIT 200`)
    .bind(query, search, search, search, search, caseType, caseType, status, status, priority, priority, flags.dataProtection ? 1 : 0, flags.safeguarding ? 1 : 0).all();
  return json({ cases: result.results });
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "cases:create");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const caseType = cleanText(body.caseType, 40);
  const priority = cleanText(body.priority || "normal", 20);
  const title = cleanText(body.title, 160);
  const description = cleanText(body.description, 4000);
  const customerReference = cleanNullableText(body.customerNumber || body.customerId, 100);
  const platformId = cleanNullableText(body.platformId, 100);
  const dueAt = body.dueAt ? normaliseDate(body.dueAt) : await defaultDueDate(context.env, priority);
  if (!CASE_TYPES.has(caseType) || !CASE_PRIORITIES.has(priority) || title.length < 3 || description.length < 5 || !dueAt) {
    return error("INVALID_CASE", "Complete the required case information.");
  }
  if (!canAccessCaseType(auth.authorisation, caseType, true)) return error("CASE_ACCESS_DENIED", "You are not authorised to create this type of case.", 403);
  const customer = customerReference ? await findCustomer(context.env, customerReference) : null;
  if (customerReference && !customer) return error("CUSTOMER_NOT_FOUND", "No customer was found with that universal reference.", 404);
  if (platformId && !await context.env.DB.prepare("SELECT id FROM platforms WHERE id=?").bind(platformId).first()) return error("PLATFORM_NOT_FOUND", "The selected division or platform was not found.", 404);

  const id = crypto.randomUUID();
  const reference = await allocateCaseReference(context.env, caseType);
  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO cases
      (id,case_reference,customer_id,platform_id,case_type,title,description,priority,status,assigned_staff_id,due_at,opened_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'open',?,?,?,?,?)`)
      .bind(id, reference, customer?.id || null, platformId, caseType, title, description, priority, auth.session.sub, dueAt, now, now, now),
    context.env.DB.prepare(`INSERT INTO case_notes
      (id,case_id,note_type,body,visibility,created_by,created_at)
      VALUES (?,?,'system',?,'case_team',?,?)`)
      .bind(crypto.randomUUID(), id, `Case opened by ${auth.session.displayName}.`, auth.session.sub, now)
  ]);
  await audit(context.env, auth.session, "case.create", "case", id, {
    label: "Head Office case created",
    reference,
    customerId: customer?.id || null,
    caseId: id,
    requestId: context.data.requestId,
    after: { caseType, title, priority, status: "open", dueAt }
  });
  return json({ id, reference }, 201);
};
