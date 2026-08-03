import { cleanText, error, json, platformAudit, readJson, requirePlatform } from '../../../_shared.js';
import {
  closePlatformSession,
  getPlatformSession,
  platformCanManageSessions,
  platformSessionDecision,
  registerConnectedSession,
} from '../../../_connected-sessions.js';

function reference(context) {
  return cleanText(decodeURIComponent(String(context.params.reference || '')), 220);
}

async function authorise(context) {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth;
  if (!platformCanManageSessions(auth.platform)) {
    return { response: error('INSUFFICIENT_PLATFORM_SCOPE', 'The platform credential cannot manage customer sessions.', 403) };
  }
  return auth;
}

export const onRequestGet = async context => {
  const auth = await authorise(context);
  if (auth.response) return auth.response;
  const session = await getPlatformSession(context.env, auth.platform.id, reference(context), true);
  return json(platformSessionDecision(session), session ? 200 : 404);
};

export const onRequestPut = async context => {
  const auth = await authorise(context);
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 16_000); }
  catch (cause) { return error(cause.code || 'INVALID_REQUEST', cause.message, cause.status || 400); }
  const existing = await getPlatformSession(context.env, auth.platform.id, reference(context), false);
  if (!existing) return error('SESSION_NOT_FOUND', 'The connected session was not found.', 404);
  const session = await registerConnectedSession(context.env, auth.platform, { id: existing.customer_id }, {
    ...(body.session || body),
    externalSessionId: existing.external_session_id,
    startedAt: existing.started_at,
  });
  return json(platformSessionDecision(session));
};

export const onRequestDelete = async context => {
  const auth = await authorise(context);
  if (auth.response) return auth.response;
  let body = {};
  try { body = await readJson(context.request, 8_000); } catch {}
  const session = await closePlatformSession(context.env, auth.platform.id, reference(context), body.reason || 'Customer signed out from the connected website.');
  if (!session) return error('SESSION_NOT_FOUND', 'The connected session was not found.', 404);
  await platformAudit(context.env, auth.platform, 'customer.session_close', 'connected_customer_session', session.id, {
    label: 'Connected website closed a customer session',
    customerId: session.customer_id,
    requestId: context.data.requestId,
    metadata: { status: session.status },
  });
  return json({ closed: true, decision: platformSessionDecision(session) });
};
