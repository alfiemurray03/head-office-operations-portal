import { cleanText, error, json } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { stripeDivisionRecords } from "../../../_stripe-control.js";
import { stripeReconciliationRecords } from "../../../_stripe-reconciliation.js";

function byLatest(field) {
  return (left, right) => String(right?.[field] || "").localeCompare(String(left?.[field] || ""));
}

async function divisionRecords(env, division, query, limit) {
  const [operations, reconciliation] = await Promise.all([
    stripeDivisionRecords(env, division, query, limit),
    stripeReconciliationRecords(env, division, query, limit)
  ]);
  return { ...operations, ...reconciliation, connector: operations.connector || reconciliation.connector };
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  const url = new URL(context.request.url);
  const division = cleanText(url.searchParams.get("division"), 80);
  const query = url.searchParams.get("q") || "";
  const limit = url.searchParams.get("limit") || 100;
  try {
    if (division) return json(await divisionRecords(context.env, division, query, limit), 200, { "Cache-Control": "no-store" });
    const [planyx, profileCentre] = await Promise.all([
      divisionRecords(context.env, "planyx", query, limit),
      divisionRecords(context.env, "profile-centre", query, limit)
    ]);
    return json({
      connector: null,
      divisions: [planyx.connector, profileCentre.connector],
      payments: [...planyx.payments, ...profileCentre.payments].sort(byLatest("occurred_at")),
      orders: [...planyx.orders, ...profileCentre.orders].sort(byLatest("occurred_at")),
      subscriptions: [...planyx.subscriptions, ...profileCentre.subscriptions].sort(byLatest("updated_at")),
      customers: [...planyx.customers, ...profileCentre.customers].sort(byLatest("updated_at")),
      transactions: [...planyx.transactions, ...profileCentre.transactions].sort(byLatest("source_created_at")),
      refunds: [...planyx.refunds, ...profileCentre.refunds].sort(byLatest("source_created_at")),
      disputes: [...planyx.disputes, ...profileCentre.disputes].sort(byLatest("source_created_at")),
      products: [...planyx.products, ...profileCentre.products].sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""))),
      prices: [...planyx.prices, ...profileCentre.prices].sort(byLatest("source_created_at")),
      syncRuns: [...planyx.syncRuns, ...profileCentre.syncRuns].sort(byLatest("started_at"))
    }, 200, { "Cache-Control": "no-store" });
  } catch (cause) {
    return error(cause.code || "STRIPE_RECORDS_UNAVAILABLE", cause.message || "Stripe records could not be loaded.", cause.status || 500);
  }
};
