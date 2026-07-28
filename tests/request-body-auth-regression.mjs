import assert from 'node:assert/strict';

const request = new Request('https://portal.example/api/test', {
  method: 'POST',
  headers: {
    Cookie: '__Host-ho_session=host-session; ho_session=legacy-session',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ mode: 'full' })
});

function headerOnlyAuthRequest(source) {
  const parts = (source.headers.get('Cookie') || '').split(';').map(value => value.trim()).filter(Boolean);
  const hostSession = parts.find(value => value.startsWith('__Host-ho_session='));
  const hostTransaction = parts.find(value => value.startsWith('__Host-ho_oidc_tx='));
  if (!hostSession && !hostTransaction) return source;
  const preferred = [];
  if (hostSession) preferred.push(`ho_session=${hostSession.slice('__Host-ho_session='.length)}`);
  if (hostTransaction) preferred.push(`ho_oidc_tx=${hostTransaction.slice('__Host-ho_oidc_tx='.length)}`);
  const remaining = parts.filter(value => !value.startsWith('ho_session=') && !value.startsWith('ho_oidc_tx='));
  const headers = new Headers(source.headers);
  headers.set('Cookie', [...preferred, ...remaining].join('; '));
  return new Request(source.url, { method: 'GET', headers });
}

const authRequest = headerOnlyAuthRequest(request);
assert.equal(authRequest.method, 'GET');
assert.match(authRequest.headers.get('Cookie') || '', /ho_session=host-session/);
assert.equal(await request.text(), JSON.stringify({ mode: 'full' }));
console.log('Authenticated POST body remains readable.');
