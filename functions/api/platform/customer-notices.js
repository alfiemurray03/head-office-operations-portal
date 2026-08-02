import { cleanText, error, json, platformAudit, readJson, requirePlatform } from "../../_shared.js";

async function resolvePlatformCustomer(env, platform, externalAccountId) {
  if (!externalAccountId) return null;
  return env.DB.prepare(`SELECT a.id account_link_id,a.customer_id,a.external_account_id,c.customer_number,c.display_name
    FROM customer_platform_accounts a JOIN customers c ON c.id=a.customer_id
    WHERE a.platform_id=? AND a.external_account_id=? LIMIT 1`)
    .bind(platform.id, externalAccountId).first();
}

function publicNotice(row) {
  return {
    id: row.id,
    reference: row.notice_reference,
    category: row.category,
    severity: row.severity,
    title: row.title,
    message: row.message,
    actionLabel: row.action_label || null,
    actionHref: row.action_href || null,
    publishedAt: row.published_at,
    expiresAt: row.expires_at || null,
    status: row.receipt_status || "delivered"
  };
}

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ["support:read"]);
  if (auth.response) return auth.response;
  const url = new URL(context.request.url);
  const externalAccountId = cleanText(url.searchParams.get("platformCustomerId") || url.searchParams.get("externalAccountId"), 160);
  const account = await resolvePlatformCustomer(context.env, auth.platform, externalAccountId);
  if (!account) return error("CUSTOMER_ACCOUNT_NOT_LINKED", "The authenticated website customer is not linked to Head Office.", 404);
  const now = new Date().toISOString();
  const result = await context.env.DB.prepare(`SELECT n.*,r.status receipt_status
    FROM customer_notices n
    LEFT JOIN customer_notice_receipts r ON r.notice_id=n.id AND r.customer_id=n.customer_id AND r.platform_id=?
    WHERE n.customer_id=? AND (n.platform_id IS NULL OR n.platform_id=?) AND n.status='published'
      AND n.published_at IS NOT NULL AND n.published_at<=?
      AND (n.expires_at IS NULL OR n.expires_at>?)
      AND COALESCE(r.status,'delivered')<>'dismissed'
    ORDER BY CASE n.severity WHEN 'critical' THEN 1 WHEN 'urgent' THEN 2 WHEN 'important' THEN 3 ELSE 4 END,
      n.published_at DESC LIMIT 50`)
    .bind(auth.platform.id, account.customer_id, auth.platform.id, now, now).all();
  for (const notice of result.results || []) {
    await context.env.DB.prepare(`INSERT INTO customer_notice_receipts
      (notice_id,customer_id,platform_id,external_account_id,status,delivered_at,updated_at)
      VALUES (?,?,?,?,'delivered',?,?)
      ON CONFLICT(notice_id,customer_id,platform_id) DO UPDATE SET
        external_account_id=excluded.external_account_id,
        delivered_at=COALESCE(customer_notice_receipts.delivered_at,excluded.delivered_at),
        updated_at=excluded.updated_at`)
      .bind(notice.id, account.customer_id, auth.platform.id, externalAccountId, now, now).run();
  }
  await platformAudit(context.env, auth.platform, "customer.notices.read", "customer", account.customer_id, {
    label: "Website retrieved customer notices",
    reference: account.customer_number,
    customerId: account.customer_id,
    requestId: context.data.requestId,
    metadata: { externalAccountId, noticeCount: (result.results || []).length }
  });
  return json({ customer: { customerNumber: account.customer_number }, notices: (result.results || []).map(publicNotice) });
};

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ["support:write"]);
  if (auth.response) return auth.response;
  try {
    const body = await readJson(context.request, 8_192);
    const externalAccountId = cleanText(body.platformCustomerId || body.externalAccountId, 160);
    const noticeId = cleanText(body.noticeId, 100);
    const action = cleanText(body.action, 20).toLowerCase();
    if (!noticeId || !["read","dismiss"].includes(action)) return error("INVALID_NOTICE_RECEIPT", "Provide a notice ID and either read or dismiss.", 400);
    const account = await resolvePlatformCustomer(context.env, auth.platform, externalAccountId);
    if (!account) return error("CUSTOMER_ACCOUNT_NOT_LINKED", "The authenticated website customer is not linked to Head Office.", 404);
    const notice = await context.env.DB.prepare(`SELECT id,notice_reference FROM customer_notices
      WHERE id=? AND customer_id=? AND (platform_id IS NULL OR platform_id=?) AND status='published' LIMIT 1`)
      .bind(noticeId, account.customer_id, auth.platform.id).first();
    if (!notice) return error("CUSTOMER_NOTICE_NOT_FOUND", "The customer notice is not available for this website account.", 404);
    const now = new Date().toISOString();
    const status = action === "dismiss" ? "dismissed" : "read";
    await context.env.DB.prepare(`INSERT INTO customer_notice_receipts
      (notice_id,customer_id,platform_id,external_account_id,status,delivered_at,first_read_at,dismissed_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(notice_id,customer_id,platform_id) DO UPDATE SET
        external_account_id=excluded.external_account_id,status=excluded.status,
        first_read_at=COALESCE(customer_notice_receipts.first_read_at,excluded.first_read_at),
        dismissed_at=CASE WHEN excluded.status='dismissed' THEN excluded.dismissed_at ELSE customer_notice_receipts.dismissed_at END,
        updated_at=excluded.updated_at`)
      .bind(notice.id, account.customer_id, auth.platform.id, externalAccountId, status, now, now, action === "dismiss" ? now : null, now).run();
    await platformAudit(context.env, auth.platform, `customer.notice.${action}`, "customer_notice", notice.id, {
      label: action === "dismiss" ? "Customer dismissed notice" : "Customer read notice",
      reference: notice.notice_reference,
      customerId: account.customer_id,
      requestId: context.data.requestId,
      metadata: { externalAccountId }
    });
    return json({ ok: true, receipt: { noticeId: notice.id, status, updatedAt: now } });
  } catch (cause) {
    return error(cause.code || "CUSTOMER_NOTICE_RECEIPT_FAILED", cause.message || "The notice status could not be recorded.", cause.status || 500, cause.details);
  }
};
