import { error, json, platformAudit, readJson, requirePlatform } from '../../_shared.js';
import {
  customerSessionView,
  findSessionCustomer,
  platformCanManageSessions,
  registerConnectedSession,
} from '../../_connected-sessions.js';

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
    const session = await registerConnectedSession(context.env, auth.platform, customer, body.session || body);
    await platformAudit(context.env, auth.platform, 'customer.session_register', 'connected_customer_session', session.id, {
      label: 'Connected website registered a customer session',
      reference: customer.customer_number,
      customerId: customer.id,
      requestId: context.data.requestId,
      metadata: { status: session.status, platformCode: auth.platform.code },
    });
    return json({ registered: true, session: customerSessionView(session) }, 201);
  } catch (cause) {
    return error(cause.code || 'SESSION_REGISTER_FAILED', cause.message || 'The connected session could not be registered.', cause.status || 500);
  }
};
