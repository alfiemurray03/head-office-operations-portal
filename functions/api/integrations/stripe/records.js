import { cleanText, error, json } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { stripeDivisionRecords } from "../../../_stripe-control.js";

function byLatest(field) {
  return (left, right) => String(right?.[field] || "").localeCompare(String(left?.[field] || ""));
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  const url = new URL(context.request.url);
  const division = cleanText(url.searchParams.get("division"), 80);
  const query = url.searchParams.get("q") || "";
  const limit = url.searchParams.get("limit") || 100;
  try {
    if (division) {
      return json(await stripeDivisionRecords(context.env, division, query, limit), 200, { "Cache-Control": "no-store" });
    }
    const [planyx, profileCentre] = await Promise.all([
      stripeDivisionRecords(context.env, "planyx", query, limit),
      stripeDivisionRecords(context.env, "profile-centre", query, limit)
    ]);
    return json({
      connector: null,
      divisions: [planyx.connector, profileCentre.connector],
      payments: [...planyx.payments, ...profileCentre.payments].sort(byLatest("occurred_at")),
      orders: [...planyx.orders, ...profileCentre.orders].sort(byLatest("occurred_at")),
      subscriptions: [...planyx.subscriptions, ...profileCentre.subscriptions].sort(byLatest("updated_at"))
    }, 200, { "Cache-Control": "no-store" });
  } catch (cause) {
    return error(cause.code || "STRIPE_RECORDS_UNAVAILABLE", cause.message || "Stripe records could not be loaded.", cause.status || 500);
  }
};
