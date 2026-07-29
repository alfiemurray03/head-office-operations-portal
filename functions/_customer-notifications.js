import { cleanText, validEmail } from "./_shared.js";

const WELCOME_TYPE = "identity.welcome_ucn";

export async function ensureCustomerNotificationSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS customer_notification_deliveries (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, notification_type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'resend', recipient_email TEXT NOT NULL,
    provider_message_id TEXT, status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sent_at TEXT,
    UNIQUE(customer_id,notification_type)
  )`).run();
}

export function resendCustomerNotificationsConfigured(env) {
  return Boolean(cleanText(env.RESEND_API_KEY, 500) && validEmail(cleanText(env.RESEND_FROM_EMAIL, 254)));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function welcomeMessage(customer) {
  const name = cleanText(customer.display_name, 160) || "Customer";
  const ucn = cleanText(customer.customer_number, 20);
  const portalName = "JA Group Services ID";
  return {
    subject: `Welcome to ${portalName} — your Unique Customer Number`,
    text: `Hello ${name},\n\nWelcome to ${portalName}. Your Unique Customer Number (UCN) is ${ucn}.\n\nYour UCN links your customer identity securely across participating JA Group Services websites and services. Keep it private and quote it when Head Office asks you to identify your account.\n\nJA Group Services Ltd\nHead Office Customer Operations & Security Centre`,
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#f3f6fb;font-family:Arial,sans-serif;color:#152033"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:auto;background:#fff;border:1px solid #dbe3ef;border-radius:16px;overflow:hidden"><tr><td style="padding:24px 28px;background:#0b1830;color:#fff"><strong style="font-size:18px">JA Group Services ID</strong><div style="margin-top:5px;color:#b8c7dd;font-size:13px">Secure customer identity across JA Group Services</div></td></tr><tr><td style="padding:30px 28px"><h1 style="margin:0 0 12px;font-size:25px">Welcome, ${escapeHtml(name)}</h1><p style="line-height:1.65;margin:0 0 20px">Your customer identity has been recognised in JA Group Services ID. A Unique Customer Number has been assigned automatically.</p><div style="padding:18px;border-radius:12px;background:#eef5ff;border:1px solid #cfe0ff;text-align:center"><div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#52627a">Unique Customer Number (UCN)</div><div style="margin-top:8px;font-size:28px;font-weight:800;letter-spacing:.12em;color:#0c4db8">${escapeHtml(ucn)}</div></div><p style="line-height:1.65;margin:22px 0 0">Your UCN securely links your customer record across participating JA Group Services websites. Keep it private and quote it only when an authorised member of staff asks for it.</p><p style="line-height:1.65;margin:16px 0 0">Kind regards,<br><strong>JA Group Services Ltd</strong><br>Head Office Customer Operations &amp; Security Centre</p></td></tr></table></td></tr></table></body></html>`
  };
}

async function recordAttempt(env, customer, status, messageId, errorMessage) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO customer_notification_deliveries
    (id,customer_id,notification_type,provider,recipient_email,provider_message_id,status,attempt_count,last_error,created_at,updated_at,sent_at)
    VALUES (?,?,?,'resend',?,?,?,?,1,?,?,?,?)
    ON CONFLICT(customer_id,notification_type) DO UPDATE SET
      recipient_email=excluded.recipient_email,provider_message_id=excluded.provider_message_id,
      status=excluded.status,attempt_count=customer_notification_deliveries.attempt_count+1,
      last_error=excluded.last_error,updated_at=excluded.updated_at,sent_at=excluded.sent_at`)
    .bind(crypto.randomUUID(), customer.id, WELCOME_TYPE, customer.verified_email, messageId || null, status,
      errorMessage || null, now, now, status === "sent" ? now : null).run();
}

async function sendWithResend(env, customer) {
  const message = welcomeMessage(customer);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${String(env.RESEND_API_KEY)}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `ja-identity-welcome-${customer.id}`
    },
    body: JSON.stringify({
      from: String(env.RESEND_FROM_EMAIL),
      to: [customer.verified_email],
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: { "X-JA-Notification-Type": WELCOME_TYPE, "X-JA-UCN": customer.customer_number }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    const reason = cleanText(data.message || data.error || `Resend returned HTTP ${response.status}`, 1000);
    throw Object.assign(new Error(reason || "Resend rejected the welcome notification."), { code: "RESEND_SEND_FAILED", status: response.status || 502 });
  }
  return data.id;
}

export async function dispatchPendingCustomerWelcomeNotifications(env, limit = 50) {
  await ensureCustomerNotificationSchema(env);
  const configured = resendCustomerNotificationsConfigured(env);
  if (!configured) return { configured: false, attempted: 0, sent: 0, failed: 0, suppressed: 0 };

  const rows = await env.DB.prepare(`SELECT DISTINCT c.id,c.customer_number,c.display_name,c.verified_email,c.account_status
    FROM customers c
    JOIN customer_directory_identities i ON i.customer_id=c.id
    LEFT JOIN customer_notification_deliveries n ON n.customer_id=c.id AND n.notification_type=?
    WHERE c.verified_email IS NOT NULL AND c.customer_number IS NOT NULL
      AND i.directory_status IN ('active','disabled')
      AND (n.id IS NULL OR n.status='failed')
    ORDER BY c.created_at ASC LIMIT ?`).bind(WELCOME_TYPE, Math.max(1, Math.min(Number(limit) || 50, 100))).all();

  const summary = { configured: true, attempted: 0, sent: 0, failed: 0, suppressed: 0 };
  for (const customer of rows.results || []) {
    if (!validEmail(customer.verified_email)) {
      await recordAttempt(env, customer, "suppressed", null, "The customer record does not contain a valid email address.");
      summary.suppressed += 1;
      continue;
    }
    summary.attempted += 1;
    try {
      const messageId = await sendWithResend(env, customer);
      await recordAttempt(env, customer, "sent", messageId, null);
      summary.sent += 1;
    } catch (cause) {
      await recordAttempt(env, customer, "failed", null, cleanText(cause?.message || String(cause), 1000));
      summary.failed += 1;
    }
  }
  return summary;
}

export async function customerNotificationStatus(env) {
  await ensureCustomerNotificationSchema(env);
  const counts = await env.DB.prepare(`SELECT status,COUNT(*) count FROM customer_notification_deliveries
    WHERE notification_type=? GROUP BY status`).bind(WELCOME_TYPE).all();
  const result = { pending: 0, sent: 0, failed: 0, suppressed: 0 };
  for (const row of counts.results || []) result[row.status] = Number(row.count || 0);
  return { configured: resendCustomerNotificationsConfigured(env), notificationType: WELCOME_TYPE, counts: result };
}
