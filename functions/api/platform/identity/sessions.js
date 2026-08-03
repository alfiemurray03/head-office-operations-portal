import { cleanText, error, json, platformAudit, readJson, requirePlatform } from '../../../_shared.js';
import {
  customerSessionView,
  findSessionCustomer,
  listCustomerSessions,
  requestAllSessionRevocations,
} from '../../../_connected-sessions.js';

function identityFromUrl(request) {
  const url = new URL(request.url);
  return {
    tenantId: cleanText(url.searchParams.get('tenantId'), 100),
    objectId: cleanText(url.searchParams.get('objectId'), 160),
    customerNumber: cleanText(url.searchParams.get('customerNumber'), 40),
  };
}

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ['customers:read']);
  if (auth.response) return auth.response;
  try {
    const customer = await findSessionCustomer(context.env, auth.platform, identityFromUrl(context.request));
    if (!customer) return error('CUSTOMER_NOT_FOUND', 'The central customer record could not be found.', 404);
    const sessions = await listCustomerSessions(context.env, customer.id);
    await platformAudit(context.env, auth.platform, 'customer.session_list_view', 'customer', customer.id, {
      label: 'Customer viewed connected sessions', reference: customer.customer_number,
      customerId: customer.id, requestId: context.data.requestId,
    });
    return json({ customerNumber: customer.customer_number, sessions: sessions.map(customerSessionView) });
  } catch (cause) {
    return error(cause.code || 'SESSION_LIST_FAILED', cause.message || 'The connected sessions could not be loaded.', cause.status || 500);
  }
};

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ['customers:write']);
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 16_000); }
  catch (cause) { return error(cause.code || 'INVALID_REQUEST', cause.message, cause.status || 400); }

  try {
    const customer = await findSessionCustomer(context.env, auth.platform, body.customer || body);
    if (!customer) return error('CUSTOMER_NOT_FOUND', 'The central customer record could not be found.', 404);
    const action = cleanText(body.action, 40).toLowerCase();
    if (!['revoke_all','revoke_others'].includes(action)) {
      return error('INVALID_SESSION_ACTION', 'Select a valid session revocation action.', 400);
    }
    const currentReference = action === 'revoke_others'
      ? cleanText(body.currentSessionReference, 220) || null
      : null;
    const changed = await requestAllSessionRevocations(context.env, customer.id, {
      source: 'customer_dashboard', actor: customer.customer_number,
      reason: cleanText(body.reason, 500) || 'Customer requested sign-out from connected services.',
    }, currentReference);
    await platformAudit(context.env, auth.platform, `customer.session_${action}`, 'customer', customer.id, {
      label: action === 'revoke_all' ? 'Customer revoked all connected sessions' : 'Customer revoked other connected sessions',
      reference: customer.customer_number, customerId: customer.id, requestId: context.data.requestId,
      metadata: { changed },
    });
    return json({ updated: true, changed, sessions: (await listCustomerSessions(context.env, customer.id)).map(customerSessionView) });
  } catch (cause) {
    return error(cause.code || 'SESSION_REVOCATION_FAILED', cause.message || 'The sessions could not be revoked.', cause.status || 500);
  }
};
