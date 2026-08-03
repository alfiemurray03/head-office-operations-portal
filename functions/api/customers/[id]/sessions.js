import { audit, cleanText, error, json, readJson } from '../../../_shared.js';
import { findCustomer, requirePermission } from '../../../_operations.js';
import {
  customerSessionView,
  listCustomerSessions,
  requestAllSessionRevocations,
} from '../../../_connected-sessions.js';

export const onRequestGet = async context => {
  const auth = await requirePermission(context, 'security:read');
  if (auth.response) return auth.response;
  const customer = await findCustomer(context.env, context.params.id);
  if (!customer) return error('CUSTOMER_NOT_FOUND', 'The universal customer record was not found.', 404);
  const sessions = await listCustomerSessions(context.env, customer.id);
  return json({ customer: { id: customer.id, customerNumber: customer.customer_number }, sessions: sessions.map(customerSessionView) });
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, 'security:write');
  if (auth.response) return auth.response;
  const customer = await findCustomer(context.env, context.params.id);
  if (!customer) return error('CUSTOMER_NOT_FOUND', 'The universal customer record was not found.', 404);
  let body = {};
  try { body = await readJson(context.request, 12_000); }
  catch (cause) { return error(cause.code || 'INVALID_REQUEST', cause.message, cause.status || 400); }
  const action = cleanText(body.action, 40).toLowerCase();
  if (action !== 'revoke_all') return error('INVALID_SESSION_ACTION', 'Select a valid Head Office session action.', 400);
  const reason = cleanText(body.reason, 500) || 'Head Office revoked all connected customer sessions.';
  const changed = await requestAllSessionRevocations(context.env, customer.id, {
    source: 'head_office', actor: auth.session.displayName, reason,
  });
  await audit(context.env, auth.session, 'customer.sessions_revoke_all', 'customer', customer.id, {
    label: 'All connected customer sessions revoked', reference: customer.customer_number,
    customerId: customer.id, requestId: context.data.requestId,
    metadata: { changed, reason },
  });
  return json({ updated: true, changed, sessions: (await listCustomerSessions(context.env, customer.id)).map(customerSessionView) });
};
