import { audit, cleanText } from "./_shared.js";
import { ensureDiditWebhookSchema } from "./_didit-webhook.js";
import { createIdentityVerification } from "./_didit-operations.js";
import { jsonValue } from "./_central-schema.js";

const DIDIT_BASE_URL = "https://verification.didit.me";
const TERMINAL_STATUSES = new Set(["Approved", "Declined", "Expired", "Abandoned", "Kyc Expired", "Cancelled"]);

function normaliseStatus(value) {
  const raw = cleanText(String(value || ""), 80).replaceAll("_", " ").trim();
  const known = {
    "not started": "Not Started",
    "awaiting user": "Awaiting User",
    "in progress": "In Progress",
    "in review": "In Review",
    approved: "Approved",
    declined: "Declined",
    expired: "Expired",
    abandoned: "Abandoned",
    "kyc expired": "Kyc Expired",
    resubmitted: "Resubmitted",
    cancelled: "Cancelled"
  };
  return known[raw.toLowerCase()] || raw || "Unknown";
}

function metadataFor(row) {
  try { return JSON.parse(row.metadata_json || "{}"); }
  catch { return {}; }
}

async function diditRequest(env, path) {
  const apiKey = cleanText(env.DIDIT_API_KEY, 500);
  if (!apiKey) {
    throw Object.assign(new Error("The Didit API key is not configured in CustomerOps."), {
      code: "DIDIT_API_NOT_CONFIGURED",
      status: 503
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${DIDIT_BASE_URL}${path}`, {
      method: "GET",
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = cleanText(
        typeof payload?.detail === "string" ? payload.detail
          : payload?.error?.message || payload?.message || `Didit returned HTTP ${response.status}.`,
        1000
      );
      throw Object.assign(new Error(message || "Didit could not complete the request."), {
        code: response.status === 401 ? "DIDIT_API_KEY_REJECTED"
          : response.status === 403 ? "DIDIT_API_PERMISSION_DENIED"
            : "DIDIT_API_REQUEST_FAILED",
        status: response.status >= 500 ? 502 : response.status,
        providerStatus: response.status
      });
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("Didit did not respond within the secure timeout."), {
        code: "DIDIT_TIMEOUT",
        status: 504
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function verificationRow(env, id, includeEmail = false) {
  const emailColumn = includeEmail ? ",c.verified_email" : "";
  return env.DB.prepare(`SELECT s.*,c.customer_number,c.display_name${emailColumn}
    FROM identity_verification_sessions s
    JOIN customers c ON c.id=s.customer_id
    WHERE s.id=? OR s.provider_session_id=? LIMIT 1`).bind(id, id).first();
}

function retainedRestrictionOutcome(row, reason) {
  return {
    lifted: false,
    retained: Boolean(row?.restriction_id),
    restrictionId: row?.restriction_id || null,
    reason
  };
}

export async function refreshIdentityVerificationSafely(env, actor, id) {
  await ensureDiditWebhookSchema(env);
  const row = await verificationRow(env, id);
  if (!row) {
    throw Object.assign(new Error("The identity-verification request was not found."), {
      code: "VERIFICATION_NOT_FOUND",
      status: 404
    });
  }

  const provider = await diditRequest(env, `/v3/session/${encodeURIComponent(row.provider_session_id)}/decision/`);
  const status = normaliseStatus(provider.status || provider.decision?.status || row.status);
  const now = new Date().toISOString();
  const restrictionOutcome = status === "Approved" && row.restriction_id
    ? retainedRestrictionOutcome(row, "The provider status was refreshed, but access changes require the verified Didit webhook or a separately authorised Head Office restriction action.")
    : null;
  const metadata = {
    ...metadataFor(row),
    refreshedBy: actor.sub,
    refreshedAt: now,
    providerDecisionPresent: Boolean(provider.decision || provider.id_verifications),
    accessChangePendingWebhook: Boolean(restrictionOutcome)
  };

  await env.DB.prepare(`UPDATE identity_verification_sessions SET status=?,decision=?,updated_at=?,
    completed_at=CASE WHEN ?=1 THEN COALESCE(completed_at,?) ELSE completed_at END,
    metadata_json=? WHERE id=?`)
    .bind(
      status,
      status,
      now,
      TERMINAL_STATUSES.has(status) ? 1 : 0,
      now,
      jsonValue(metadata, {}),
      row.id
    ).run();

  await audit(env, actor, "identity.verification.refresh", "identity_verification", row.id, {
    label: "Didit verification status refreshed",
    reference: row.customer_number,
    customerId: row.customer_id,
    before: { status: row.status },
    after: { status, restrictionOutcome },
    metadata: {
      provider: "didit",
      providerSessionId: row.provider_session_id,
      sourceOfTruth: "signed_webhook_for_access_changes"
    }
  });

  return { id: row.id, status, restrictionOutcome };
}

export async function resumeIdentityVerificationSafely(env, actor, id) {
  await ensureDiditWebhookSchema(env);
  const row = await verificationRow(env, id, true);
  if (!row) {
    throw Object.assign(new Error("The identity-verification request was not found."), {
      code: "VERIFICATION_NOT_FOUND",
      status: 404
    });
  }

  const previousMetadata = metadataFor(row);
  const replacement = await createIdentityVerification(env, actor, {
    customerId: row.customer_id,
    purpose: previousMetadata.purpose || "identity_security",
    accessMode: previousMetadata.accessMode || "request_only",
    scope: previousMetadata.scope || row.platform_id || "company_wide",
    reason: previousMetadata.reason || "Replacement link issued for an existing Head Office identity-verification request.",
    source: "resume",
    sendNotificationEmails: true
  });
  const now = new Date().toISOString();
  const replacementId = replacement.session?.id || null;
  const replacementProviderSessionId = replacement.session?.providerSessionId || null;

  await env.DB.prepare("UPDATE identity_verification_sessions SET metadata_json=?,updated_at=? WHERE id=?")
    .bind(jsonValue({
      ...previousMetadata,
      resumedAt: now,
      resumedBy: actor.sub,
      replacementSessionId: replacementId,
      replacementProviderSessionId
    }, {}), now, row.id).run();

  await audit(env, actor, "identity.verification.resume", "identity_verification", row.id, {
    label: "Didit replacement verification link created",
    reference: row.customer_number,
    customerId: row.customer_id,
    before: { status: row.status, providerSessionId: row.provider_session_id },
    after: {
      status: replacement.session?.status || "Not Started",
      replacementSessionId,
      replacementProviderSessionId,
      customerNotificationRequested: true
    },
    metadata: { provider: "didit", source: "resume" }
  });

  return {
    id: replacementId,
    previousId: row.id,
    status: replacement.session?.status || "Not Started",
    verificationUrl: replacement.verificationUrl,
    session: replacement.session,
    replacement: true
  };
}

export async function cancelIdentityVerificationSafely(env, actor, id, reason) {
  await ensureDiditWebhookSchema(env);
  const row = await verificationRow(env, id);
  if (!row) {
    throw Object.assign(new Error("The identity-verification request was not found."), {
      code: "VERIFICATION_NOT_FOUND",
      status: 404
    });
  }

  const cancellationReason = cleanText(reason, 1000);
  if (cancellationReason.length < 5) {
    throw Object.assign(new Error("Enter a reason for cancelling the request."), {
      code: "CANCELLATION_REASON_REQUIRED",
      status: 400
    });
  }

  const now = new Date().toISOString();
  const restrictionOutcome = retainedRestrictionOutcome(
    row,
    row.restriction_id
      ? "Cancelling a verification request does not remove its Head Office access requirement. Lift that restriction separately only after an authorised decision."
      : "No linked access requirement was present."
  );
  const metadata = {
    ...metadataFor(row),
    cancelledBy: actor.sub,
    cancelledAt: now,
    cancellationReason,
    restrictionRetained: Boolean(row.restriction_id)
  };

  await env.DB.prepare(`UPDATE identity_verification_sessions SET
    status='Cancelled',decision='Cancelled',updated_at=?,completed_at=COALESCE(completed_at,?),metadata_json=?
    WHERE id=?`)
    .bind(now, now, jsonValue(metadata, {}), row.id).run();

  await env.DB.prepare(`INSERT INTO customer_timeline_events
    (id,customer_id,platform_id,event_type,event_category,title,summary,occurred_at,source_reference,metadata_json)
    VALUES (?,?,NULL,'identity.verification.cancelled','security','Identity verification cancelled',?,?,?,?)`)
    .bind(
      crypto.randomUUID(),
      row.customer_id,
      cancellationReason,
      now,
      row.provider_session_id,
      jsonValue({ restrictionOutcome }, {})
    ).run();

  await audit(env, actor, "identity.verification.cancel", "identity_verification", row.id, {
    label: "Didit verification request cancelled",
    reference: row.customer_number,
    customerId: row.customer_id,
    before: { status: row.status },
    after: { status: "Cancelled", restrictionOutcome },
    metadata: { provider: "didit", reason: cancellationReason }
  });

  return { id: row.id, status: "Cancelled", restrictionOutcome };
}
