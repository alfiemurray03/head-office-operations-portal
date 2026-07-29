import { cleanText, json } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { ensureStripeControlSchema } from "../../../_stripe-control.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  await ensureStripeControlSchema(context.env);
  const url = new URL(context.request.url);
  const query = cleanText(url.searchParams.get("q"), 120);
  const limit = Math.max(10, Math.min(Number(url.searchParams.get("limit")) || 100, 250));
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const [payments, orders, subscriptions] = await context.env.DB.batch([
    context.env.DB.prepare(`SELECT p.*,c.display_name customer_name,c.verified_email customer_email
      FROM stripe_payment_records p LEFT JOIN customers c ON c.id=p.customer_id
      WHERE (?='' OR p.stripe_object_id LIKE ? ESCAPE '\\' OR p.customer_number LIKE ? ESCAPE '\\'
        OR c.display_name LIKE ? ESCAPE '\\' OR p.receipt_email LIKE ? ESCAPE '\\')
      ORDER BY p.occurred_at DESC LIMIT ?`).bind(query, search, search, search, search, limit),
    context.env.DB.prepare(`SELECT o.*,c.display_name customer_name,c.verified_email customer_email
      FROM stripe_order_records o LEFT JOIN customers c ON c.id=o.customer_id
      WHERE (?='' OR o.stripe_object_id LIKE ? ESCAPE '\\' OR o.customer_number LIKE ? ESCAPE '\\'
        OR c.display_name LIKE ? ESCAPE '\\' OR o.customer_email LIKE ? ESCAPE '\\')
      ORDER BY o.occurred_at DESC LIMIT ?`).bind(query, search, search, search, search, limit),
    context.env.DB.prepare(`SELECT s.*,c.display_name customer_name,c.verified_email customer_email
      FROM stripe_subscription_records s LEFT JOIN customers c ON c.id=s.customer_id
      WHERE (?='' OR s.stripe_subscription_id LIKE ? ESCAPE '\\' OR s.customer_number LIKE ? ESCAPE '\\'
        OR c.display_name LIKE ? ESCAPE '\\' OR s.stripe_customer_id LIKE ? ESCAPE '\\')
      ORDER BY s.updated_at DESC LIMIT ?`).bind(query, search, search, search, search, limit)
  ]);
  return json({ payments: payments.results || [], orders: orders.results || [], subscriptions: subscriptions.results || [] }, 200, { "Cache-Control": "no-store" });
};
