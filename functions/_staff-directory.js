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

export async function ensureStaffNumber(env, staffId) {
  const existing = await env.DB.prepare("SELECT staff_number FROM staff_members WHERE id=?").bind(staffId).first();
  if (!existing) return null;
  if (existing.staff_number) return existing.staff_number;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const staffNumber = await allocateStaffNumber(env);
    try {
      await env.DB.prepare("UPDATE staff_members SET staff_number=?,updated_at=? WHERE id=? AND staff_number IS NULL")
        .bind(staffNumber, new Date().toISOString(), staffId).run();
      const saved = await env.DB.prepare("SELECT staff_number FROM staff_members WHERE id=?").bind(staffId).first();
      if (saved?.staff_number) return saved.staff_number;
    } catch (cause) {
      if (!String(cause).includes("staff_number")) throw cause;
    }
  }
  throw Object.assign(new Error("A unique staff number could not be allocated."), { code: "STAFF_NUMBER_ALLOCATION_FAILED", status: 503 });
}

export function staffDirectoryAuditReference(staff) {
  return staff?.staff_number || staff?.email || staff?.id || "Staff record";
}
