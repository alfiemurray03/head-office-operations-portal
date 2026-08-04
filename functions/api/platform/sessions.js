import { cleanText, error, json, platformAudit, readJson, requirePlatform } from '../../_shared.js';
import {
  customerSessionView,
  findSessionCustomer,
  platformCanManageSessions,
  registerConnectedSession,
} from '../../_connected-sessions.js';

const MINIMUM_SESSION_REFRESH_MS = 4 * 60 * 1000;

function timestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const parsed = Date.parse(normalised);
  return Number.isFinite(parsed) ? parsed : 0;
}

function externalSessionId(body = {}) {
  return cleanText(body.externalSessionId || body.sessionReference || body.sessionId, 220);
}

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth.response;
  if (!platformCanManageSessions(auth.platform)) {
    return error('INSUFFICIENT_PLATFORM_SCOPE', 'The platform credential cannot report customer sessions.', 403);
  }

  let body;
  try { body = await readJson(context.request, 32_000); }
  catch (cause) { return error(cause.code || 'INVALID_REQUEST', cause.message, cause.status || 400); }

  try {
    const customer = await findSessionCustomer(context.env, auth.platform, body.customer || body);
    if (!customer) return error('CUSTOMER_NOT_FOUND', 'The session could not be linked to an authoritative customer record.', 404);

    const sessionInput = body.session || body;
    const reference = externalSessionId(sessionInput);
    const existing = reference
      ? await context.env.DB.prepare(`SELECT s.*,p.code platform_code,p.name platform_name
          FROM connected_customer_sessions s JOIN platforms p ON p.id=s.platform_id
          WHERE s.platform_id=? AND s.external_session_id=? LIMIT 1`)
          .bind(auth.platform.id, reference).first()
      : null;

    if (
      existing
      && existing.customer_id === customer.id
      && existing.status === 'active'
      && Date.now() - timestamp(existing.last_seen_at) < MINIMUM_SESSION_REFRESH_MS
    ) {
      return json({ registered: true, refreshed: false, session: customerSessionView(existing) }, 200, {
        'X-Head-Office-Session-Write': 'throttled',
      });
    }

    const session = await registerConnectedSession(context.env, auth.platform, customer, sessionInput);
    if (!existing) {
      await platformAudit(context.env, auth.platform, 'customer.session_register', 'connected_customer_session', session.id, {
        label: 'Connected website registered a customer session',
        reference: customer.customer_number,
        customerId: customer.id,
        requestId: context.data.requestId,
        metadata: { status: session.status, platformCode: auth.platform.code },
      });
    }

    return json({ registered: true, refreshed: true, session: customerSessionView(session) }, existing ? 200 : 201, {
      'X-Head-Office-Session-Write': existing ? 'refreshed' : 'created',
    });
  } catch (cause) {
    return error(cause.code || 'SESSION_REGISTER_FAILED', cause.message || 'The connected session could not be registered.', cause.status || 500);
  }
};
