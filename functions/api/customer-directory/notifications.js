import { audit, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { customerNotificationStatus, dispatchPendingCustomerWelcomeNotifications } from "../../_customer-notifications.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "communications:read");
  if (auth.response) return auth.response;
  return json(await customerNotificationStatus(context.env), 200, { "Cache-Control": "no-store" });
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "communications:write");
  if (auth.response) return auth.response;
  let body = {};
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const result = await dispatchPendingCustomerWelcomeNotifications(context.env, body.limit || 50);
  await audit(context.env, auth.session, "customer_notifications.welcome_dispatched", "customer_notification", "identity.welcome_ucn", {
    label: "Pending JA Group Services ID welcome notifications processed",
    reference: "Resend",
    requestId: context.data.requestId,
    after: result
  });
  return json(result);
};
