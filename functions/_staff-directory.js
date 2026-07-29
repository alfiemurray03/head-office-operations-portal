import { cleanText, validEmail } from "./_shared.js";

export const STAFF_EMPLOYMENT_TYPES = new Set(["director", "employee", "contractor", "agency", "volunteer", "other"]);
export const STAFF_STATUSES = new Set(["active", "suspended", "left", "archived"]);
export const STAFF_REVIEW_TYPES = new Set(["identity", "security", "safeguarding", "conduct", "right_to_work", "other"]);
export const STAFF_REVIEW_STATUSES = new Set(["open", "in_review", "completed", "cancelled"]);

export function normaliseStaffEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return validEmail(email) ? email : "";
}

export function normaliseStaffDirectoryInput(input = {}) {
  const displayName = cleanText(input.displayName, 160);
  const email = normaliseStaffEmail(input.email);
  const employmentType = cleanText(input.employmentType, 40).toLowerCase() || "employee";
  const status = cleanText(input.status, 40).toLowerCase() || "active";
  if (!displayName) throw Object.assign(new Error("Enter the staff member's name."), { code: "STAFF_NAME_REQUIRED", status: 400 });
  if (!email) throw Object.assign(new Error("Enter a valid staff email address."), { code: "STAFF_EMAIL_REQUIRED", status: 400 });
  if (!STAFF_EMPLOYMENT_TYPES.has(employmentType)) throw Object.assign(new Error("Select a valid staff employment type."), { code: "INVALID_EMPLOYMENT_TYPE", status: 400 });
  if (!STAFF_STATUSES.has(status)) throw Object.assign(new Error("Select a valid staff status."), { code: "INVALID_STAFF_STATUS", status: 400 });
  return {
    displayName,
    email,
    jobTitle: cleanText(input.jobTitle, 160) || null,
    employmentType,
    organisationUnitId: cleanText(input.organisationUnitId, 100) || null,
    divisionCode: cleanText(input.divisionCode, 80).toUpperCase() || null,
    department: cleanText(input.department, 160) || null,
    telephone: cleanText(input.telephone, 60) || null,
    internalExtension: cleanText(input.internalExtension, 30) || null,
    startDate: cleanText(input.startDate, 20) || null,
    endDate: cleanText(input.endDate, 20) || null,
    notes: cleanText(input.notes, 2000) || null,
    status
  };
}

export async function allocateStaffNumber(env) {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`INSERT INTO staff_number_sequences(sequence_key,next_value,updated_at)
    VALUES ('staff',2,?)
    ON CONFLICT(sequence_key) DO UPDATE SET next_value=staff_number_sequences.next_value+1,updated_at=excluded.updated_at
    RETURNING next_value-1 allocated`).bind(now).first();
  return `STF-${String(Number(row?.allocated || 1)).padStart(6, "0")}`;
}

export async function ensureStaffDirectoryProfiles(env) {
  const missing = await env.DB.prepare(`SELECT s.id,s.display_name,s.email,s.status,s.created_at,s.updated_at
    FROM staff_members s
    LEFT JOIN staff_directory_profiles p ON p.linked_staff_member_id=s.id
    WHERE p.id IS NULL ORDER BY s.created_at,s.id LIMIT 500`).all();
  for (const staff of missing.results) {
    const staffNumber = await allocateStaffNumber(env);
    await env.DB.prepare(`INSERT OR IGNORE INTO staff_directory_profiles
      (id,staff_number,linked_staff_member_id,display_name,email,employment_type,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'employee',?,?,?)`)
      .bind(crypto.randomUUID(), staffNumber, staff.id, staff.display_name, staff.email,
        staff.status === "active" ? "active" : "suspended", staff.created_at, staff.updated_at).run();
  }
  return missing.results.length;
}

export function staffDirectoryAuditReference(staff) {
  return staff?.staff_number || staff?.email || staff?.id || "Staff record";
}
