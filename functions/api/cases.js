import { audit, cleanText, error, json, requireSession } from "../_shared.js";

const types = new Set(["security","complaint","refund","payment_dispute","account_recovery","data_protection","safeguarding","general"]);
const priorities = new Set(["low","normal","high","critical"]);

export const onRequestGet = async context => {
  const auth = await requireSession(context); if (auth.response) return auth.response;
  const result = await context.env.DB.prepare(`SELECT c.case_reference,c.title,c.case_type,c.priority,c.status,c.due_at,u.customer_number FROM cases c LEFT JOIN customers u ON u.id=c.customer_id ORDER BY c.created_at DESC LIMIT 100`).all();
  return json({ cases: result.results });
};

export const onRequestPost = async context => {
  const auth = await requireSession(context); if (auth.response) return auth.response;
  const body = await context.request.json().catch(() => ({}));
  const caseType = cleanText(body.caseType, 40), priority = cleanText(body.priority, 20);
  const title = cleanText(body.title, 160), description = cleanText(body.description, 4000), number = cleanText(body.customerNumber, 10);
  if (!types.has(caseType) || !priorities.has(priority) || title.length < 3 || description.length < 5) return error("INVALID_CASE", "Complete the required case information.");
  const customer = number ? await context.env.DB.prepare("SELECT id FROM customers WHERE customer_number=?").bind(number).first() : null;
  if (number && !customer) return error("CUSTOMER_NOT_FOUND", "No customer was found with that universal number.", 404);
  const prefix = ({ security:"SEC", complaint:"COM", refund:"REF", payment_dispute:"PAY", account_recovery:"ACR", data_protection:"DPR", safeguarding:"SAF", general:"OPS" })[caseType];
  const year = new Date().getUTCFullYear();
  const count = await context.env.DB.prepare("SELECT COUNT(*) count FROM cases WHERE case_type=? AND opened_at >= ?").bind(caseType, `${year}-01-01T00:00:00.000Z`).first();
  const reference = `${prefix}-${year}-${String(Number(count.count) + 1).padStart(6,"0")}`;
  const id = crypto.randomUUID(), now = new Date().toISOString();
  try {
    await context.env.DB.prepare(`INSERT INTO cases (id,case_reference,customer_id,case_type,title,description,priority,status,opened_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'open',?,?,?)`).bind(id, reference, customer?.id || null, caseType, title, description, priority, now, now, now).run();
  } catch (cause) {
    if (String(cause).includes("case_reference")) return error("REFERENCE_CONFLICT", "Please submit the case again.", 409);
    throw cause;
  }
  await audit(context.env, auth.session, "case.create", "case", id, { label: "Case created", reference, metadata: { caseType, priority } });
  return json({ id, reference }, 201);
};
