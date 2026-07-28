import { audit, cleanText, error, json, readJson } from "../../../_shared.js";
import { canAccessCaseType, findCase, hasPermission, requirePermission } from "../../../_operations.js";

const NOTE_TYPES = new Set(["internal", "customer_contact", "decision"]);
const VISIBILITIES = new Set(["case_team", "head_office", "restricted_dpo", "restricted_safeguarding"]);

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "cases:read");
  if (auth.response) return auth.response;
  const record = await findCase(context.env, context.params.id);
  if (!record) return error("CASE_NOT_FOUND", "The Head Office case was not found.", 404);
  if (!canAccessCaseType(auth.authorisation, record.case_type, true)) return error("CASE_ACCESS_DENIED", "You are not authorised to add notes to this case.", 403);
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const noteType = cleanText(body.noteType || "internal", 30);
  const visibility = cleanText(body.visibility || "case_team", 40);
  const noteBody = cleanText(body.body, 4000);
  if (!NOTE_TYPES.has(noteType) || !VISIBILITIES.has(visibility) || noteBody.length < 2) return error("INVALID_CASE_NOTE", "Enter a valid case note.");
  if (visibility === "restricted_dpo" && !hasPermission(auth.authorisation, "data_protection:*")) return error("DPO_PERMISSION_REQUIRED", "Only authorised data protection staff may create restricted DPO notes.", 403);
  if (visibility === "restricted_safeguarding" && !hasPermission(auth.authorisation, "safeguarding:*")) return error("SAFEGUARDING_PERMISSION_REQUIRED", "Only authorised safeguarding staff may create restricted safeguarding notes.", 403);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await context.env.DB.prepare(`INSERT INTO case_notes
    (id,case_id,note_type,body,visibility,created_by,created_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(id, record.id, noteType, noteBody, visibility, auth.session.sub, now).run();
  await audit(context.env, auth.session, "case.note_added", "case", record.id, {
    label: "Case note added",
    reference: record.case_reference,
    customerId: record.customer_id,
    caseId: record.id,
    requestId: context.data.requestId,
    metadata: { noteId: id, noteType, visibility }
  });
  return json({ id, createdAt: now }, 201);
};
