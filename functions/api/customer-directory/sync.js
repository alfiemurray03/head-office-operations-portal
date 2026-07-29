import { assertSameOrigin, audit, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { assertSystemServiceEnabled } from "../../_runtime-policy.js";
import { CUSTOMER_DIRECTORY_CONNECTOR_ID } from "../../_customer-entra.js";
import { syncCustomerDirectory } from "../../_customer-entra-sync.js";
import { dispatchPendingCustomerWelcomeNotifications } from "../../_customer-notifications.js";

export const onRequestPost = async context => {
  const originError = assertSameOrigin(context.request);
  if (originError) return originError;
  const auth = await requirePermission(context, "administration:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const mode = body.mode === "full" ? "full" : "delta";
  try {
    await assertSystemServiceEnabled(context.env, "integrations.customer_directory_enabled", "JA Group Services ID synchronisation");
    const result = await syncCustomerDirectory(context.env, mode, auth.session.sub);
    const requestedNotificationLimit = Math.max(5, Math.min(Number(body.notificationLimit) || 25, 50));
    const notificationLimit = result.partial ? Math.min(requestedNotificationLimit, 5) : requestedNotificationLimit;
    const notifications = await dispatchPendingCustomerWelcomeNotifications(context.env, notificationLimit);
    const response = { ...result, notifications };
    await audit(context.env, auth.session, "customer_directory.synchronised", "customer_directory_connector", CUSTOMER_DIRECTORY_CONNECTOR_ID, {
      label: result.partial
        ? "Microsoft customer directory batch synchronised"
        : mode === "full" ? "Full Microsoft customer import completed" : "Microsoft customer directory changes synchronised",
      reference: "JA Group Services ID",
      requestId: context.data.requestId,
      after: {
        mode: result.mode,
        runId: result.runId,
        partial: Boolean(result.partial),
        continuationPending: Boolean(result.continuationPending),
        stats: result.stats,
        totals: result.totals,
        notifications
      }
    });
    return json(response);
  } catch (cause) {
    return error(cause.code || "CUSTOMER_DIRECTORY_SYNC_FAILED", cause.message || "The Microsoft customer directory could not be synchronised.", cause.status || 502, cause.details);
  }
};
