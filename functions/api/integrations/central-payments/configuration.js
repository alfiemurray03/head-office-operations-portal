import { audit, cleanText, error, json, readJson } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import {
  CENTRAL_PAYMENT_BRANDS,
  CENTRAL_STRIPE_REQUIRED_EVENTS,
  centralPaymentError,
  centralPaymentsConfiguration,
  ensureCentralPaymentsSchema,
  verifyCentralStripeAccount,
} from "../../../_central-payments.js";

function normaliseOrigin(value) {
  let parsed;
  try { parsed = new URL(cleanText(value, 500)); }
  catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
  return parsed.origin;
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  try {
    await ensureCentralPaymentsSchema(context.env);
    const origin = new URL(context.request.url).origin;
    const configuration = centralPaymentsConfiguration(context.env, origin);
    let stripeAccount = null;
    let stripeError = null;
    if (configuration.stripeKeyConfigured && configuration.expectedStripeAccountIdConfigured) {
      try {
        const account = await verifyCentralStripeAccount(context.env);
        stripeAccount = {
          id: account.id,
          businessName: account.business_profile?.name || account.settings?.dashboard?.display_name || null,
          chargesEnabled: Boolean(account.charges_enabled),
          payoutsEnabled: Boolean(account.payouts_enabled),
          country: account.country || null,
          defaultCurrency: account.default_currency || null,
        };
      } catch (cause) {
        stripeError = { code: cause.code || "STRIPE_ACCOUNT_CHECK_FAILED", message: cause.message };
      }
    }
    const origins = await context.env.DB.prepare(`SELECT o.id,o.platform_id,p.code platform_code,p.name platform_name,o.origin,o.status,o.created_at,o.updated_at
      FROM central_payment_platform_origins o JOIN platforms p ON p.id=o.platform_id
      ORDER BY p.name,o.origin`).all();
    return json({
      configuration,
      stripeAccount,
      stripeError,
      brands: CENTRAL_PAYMENT_BRANDS,
      requiredWebhookEvents: CENTRAL_STRIPE_REQUIRED_EVENTS,
      platformOrigins: origins.results || [],
    });
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments configuration could not be read.");
  }
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "payments:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 16_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    await ensureCentralPaymentsSchema(context.env);
    const action = cleanText(body.action, 40);
    const platformId = cleanText(body.platformId, 80);
    const platform = platformId ? await context.env.DB.prepare("SELECT id,code,name FROM platforms WHERE id=? LIMIT 1").bind(platformId).first() : null;
    if (!platform) return error("PLATFORM_NOT_FOUND", "Select a connected platform.", 404);

    if (action === "addOrigin") {
      const origin = normaliseOrigin(body.origin);
      if (!origin) return error("INVALID_PAYMENT_ORIGIN", "Enter an HTTPS origin only, for example https://service.example.com.", 400);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      await context.env.DB.prepare(`INSERT INTO central_payment_platform_origins(id,platform_id,origin,status,created_at,updated_at)
        VALUES (?,?,?,'active',?,?)
        ON CONFLICT(platform_id,origin) DO UPDATE SET status='active',updated_at=excluded.updated_at`)
        .bind(id, platform.id, origin, now, now).run();
      await audit(context.env, auth.session, "central_payment.origin.add", "central_payment_platform_origin", id, {
        label: "Central Payments return origin authorised",
        reference: origin,
        requestId: context.data.requestId,
        metadata: { platformId: platform.id, platformCode: platform.code },
      });
      return json({ ok: true, platformId: platform.id, origin }, 201);
    }

    if (action === "removeOrigin") {
      const origin = normaliseOrigin(body.origin);
      if (!origin) return error("INVALID_PAYMENT_ORIGIN", "Enter the HTTPS origin to remove.", 400);
      const now = new Date().toISOString();
      const result = await context.env.DB.prepare(`UPDATE central_payment_platform_origins SET status='revoked',updated_at=?
        WHERE platform_id=? AND origin=? AND status='active'`).bind(now, platform.id, origin).run();
      if (!Number(result.meta?.changes || 0)) return error("PAYMENT_ORIGIN_NOT_FOUND", "That active Central Payments origin was not found.", 404);
      await audit(context.env, auth.session, "central_payment.origin.remove", "central_payment_platform_origin", platform.id, {
        label: "Central Payments return origin revoked",
        reference: origin,
        requestId: context.data.requestId,
        metadata: { platformId: platform.id, platformCode: platform.code },
      });
      return json({ ok: true, platformId: platform.id, origin });
    }

    return error("UNKNOWN_CONFIGURATION_ACTION", "Choose addOrigin or removeOrigin.", 400);
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments configuration could not be changed.");
  }
};
