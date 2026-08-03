import { cleanText, error, json, platformAudit, readJson, requirePlatform } from '../../../../_shared.js';
import {
  customerSessionView,
  ensureConnectedSessionSchema,
  findSessionCustomer,
  listCustomerSessions,
  requestSessionRevocation,
} from '../../../../_connected-sessions.js';

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ['customers:write']);
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 16_000); }
  catch (cause) { return error(cause.code || 'INVALID_REQUEST', cause.message, cause.status || 400); }

  try {
    await ensureConnectedSessionSchema(context.env);
    const customer = await findSessionCustomer(context.env, auth.platform, body.customer || body);
    if (!customer) return error('CUSTOMER_NOT_FOUND', 'The central customer record could not be found.', 404);
    const sessionId = cleanText(context.params.id, 100);
    const owned = await context.env.DB.prepare(`SELECT id FROM connected_customer_sessions
      WHERE id=? AND customer_id=? LIMIT 1`).bind(sessionId, customer.id).first();
    if (!owned) return error('SESSION_NOT_FOUND', 'The selected session does not belong to this customer.', 404);
    const session = await requestSessionRevocation(context.env, sessionId, {
      source: 'customer_dashboard', actor: customer.customer_number,
      reason: cleanText(body.reason, 500) || 'Customer requested sign-out from this device.',
    });
    await platformAudit(context.env, auth.platform, 'customer.session_revoke', 'connected_customer_session', session.id, {
      label: 'Customer revoked a connected session', reference: customer.customer_number,
      customerId: customer.id, requestId: context.data.requestId,
      metadata: { platformCode: session.platform_code },
    });
    return json({ updated: true, session: customerSessionView(session), sessions: (await listCustomerSessions(context.env, customer.id)).map(customerSessionView) });
  } catch (cause) {
    return error(cause.code || 'SESSION_REVOCATION_FAILED', cause.message || 'The session could not be revoked.', cause.status || 500);
  }
};
