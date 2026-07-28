import { assertSameOrigin, audit, cleanText, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { manageCustomerDirectoryAccount } from "../../_customer-entra.js";

const SENSITIVE_ACTIONS = new Set(["suspend", "reactivate", "revoke_sessions"]);

export const onRequestPut = async context => {
  const originError = assertSameOrigin(context.request);
  if (originError) return originError;
  const auth = await requirePermission(context, "administration:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  const identityId = cleanText(body.identityId, 100);
  const action = cleanText(body.action, 40);
  const reason = cleanText(body.reason, 1000);
  if (!identityId || !["suspend", "reactivate", "revoke_sessions", "update_profile"].includes(action)) {
    return error("INVALID_DIRECTORY_ACCOUNT_ACTION", "Select a valid Microsoft customer account and action.");
  }
  if (SENSITIVE_ACTIONS.has(action) && reason.length < 5) {
    return error("ACTION_REASON_REQUIRED", "Enter the operational or security reason for this account action.");
  }

  try {
    const result = await manageCustomerDirectoryAccount(context.env, identityId, action, body);
    await audit(context.env, auth.session, `customer_directory.account.${action}`, "customer_directory_identity", identityId, {
      label: {
        suspend: "Microsoft customer account suspended",
        reactivate: "Microsoft customer account reactivated",
        revoke_sessions: "Microsoft customer sessions revoked",
        update_profile: "Microsoft customer profile updated"
      }[action],
      reference: result.identity?.object_id || identityId,
      customerId: result.identity?.customer_id || null,
      requestId: context.data.requestId,
      before: { accountStatus: result.identity?.account_status || null, directoryStatus: result.identity?.directory_status || null },
      after: { action, accountEnabled: result.accountEnabled },
      metadata: { reason: reason || "Profile maintenance" }
    });
    return json({ ok: true, action, accountEnabled: result.accountEnabled });
  } catch (cause) {
    return error(cause.code || "CUSTOMER_DIRECTORY_ACCOUNT_FAILED", cause.message || "The Microsoft customer account action could not be completed.", cause.status || 502, cause.details);
  }
};
