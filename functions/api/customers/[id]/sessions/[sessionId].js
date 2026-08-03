import { audit, cleanText, error, json, readJson } from '../../../../_shared.js';
import { findCustomer, requirePermission } from '../../../../_operations.js';
import {
  customerSessionView,
  ensureConnectedSessionSchema,
  listCustomerSessions,
  requestSessionRevocation,
} from '../../../../_connected-sessions.js';

export const onRequestPost = async context => {
  const auth = await requirePermission(context, 'security:write');
  if (auth.response) return auth.response;
  const customer = await findCustomer(context.env, context.params.id);
  if (!customer) return error('CUSTOMER_NOT_FOUND', 'The universal customer record was not found.', 404);
  await ensureConnectedSessionSchema(context.env);
  const sessionId = cleanText(context.params.sessionId, 100);
  const owned = await context.env.DB.prepare(`SELECT id FROM connected_customer_sessions
    WHERE id=? AND customer_id=? LIMIT 1`).bind(sessionId, customer.id).first();
  if (!owned) return error('SESSION_NOT_FOUND', 'The selected connected session was not found for this customer.', 404);
  let body = {};
  try { body = await readJson(context.request, 12_000); } catch {}
  const reason = cleanText(body.reason, 500) || 'Head Office revoked this connected customer session.';
  const session = await requestSessionRevocation(context.env, sessionId, {
    source: 'head_office', actor: auth.session.displayName, reason,
  });
  await audit(context.env, auth.session, 'customer.session_revoke', 'connected_customer_session', session.id, {
    label: 'Connected customer session revoked', reference: customer.customer_number,
    customerId: customer.id, requestId: context.data.requestId,
    metadata: { reason, platformCode: session.platform_code },
  });
  return json({ updated: true, session: customerSessionView(session), sessions: (await listCustomerSessions(context.env, customer.id)).map(customerSessionView) });
};
