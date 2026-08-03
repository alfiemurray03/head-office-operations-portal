(() => {
  let installed = false;
  let currentCustomerId = null;

  const html = value => window.escapeHtml ? window.escapeHtml(value ?? '') : String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const date = value => window.formatDate ? window.formatDate(value, 'Not reported') : (value || 'Not reported');
  const canWrite = () => typeof window.hasPermission === 'function' && window.hasPermission('security:write');

  function locationText(session) {
    const location = session.location || {};
    return [location.city, location.region, location.countryName || location.countryCode].filter(Boolean).join(', ');
  }

  function deviceText(session) {
    const device = session.device || {};
    return device.name || [device.browser, device.operatingSystem].filter(Boolean).join(' on ') || device.category || 'Unrecognised device';
  }

  function statusTag(status) {
    return window.tag ? window.tag(status) : `<span class="tag">${html(String(status || 'unknown').replaceAll('_', ' '))}</span>`;
  }

  function sessionRow(session, customerId) {
    const active = session.status === 'active';
    const pending = session.status === 'revocation_required';
    const action = active && canWrite()
      ? `<button type="button" class="button danger small" data-central-session-revoke="${html(session.id)}" data-customer-id="${html(customerId)}">Revoke session</button>`
      : pending ? '<span class="tag warning">Revocation pending</span>' : '';
    const place = locationText(session);
    const details = [
      `Started ${date(session.startedAt)}`,
      `Last seen ${date(session.lastSeenAt)}`,
      place,
      session.expiresAt ? `Expires ${date(session.expiresAt)}` : '',
    ].filter(Boolean).join(' · ');
    return `<article class="customer-record-list-item connected-session-row">
      <div><strong>${html(session.platformName || session.platformCode || 'Connected service')}</strong><span>${html(deviceText(session))}</span><small>${html(details)}</small></div>
      <div class="customer-record-list-meta">${statusTag(session.status)}${action}</div>
    </article>`;
  }

  function findSessionsPanel() {
    return [...document.querySelectorAll('.customer-record-panel')]
      .find(panel => panel.querySelector('h2')?.textContent?.trim() === 'Sessions & devices');
  }

  function updateSummary(sessions) {
    const live = sessions.filter(session => session.status === 'active').length;
    const metric = [...document.querySelectorAll('.customer-record-status')]
      .find(card => card.querySelector('span')?.textContent?.trim() === 'Live sessions');
    if (metric) {
      const strong = metric.querySelector('strong');
      const small = metric.querySelector('small');
      if (strong) strong.textContent = String(live);
      if (small) small.textContent = `${sessions.length} central session record${sessions.length === 1 ? '' : 's'}`;
    }
  }

  async function enhance(customerId) {
    const panel = findSessionsPanel();
    if (!panel) return;
    currentCustomerId = customerId;
    const list = panel.querySelector('.customer-record-list');
    try {
      const result = await window.api(`/api/customers/${encodeURIComponent(customerId)}/sessions`, { timeoutMs: 12_000 });
      const sessions = result.sessions || [];
      updateSummary(sessions);
      const count = panel.querySelector('header .tag');
      if (count) count.textContent = String(sessions.length);
      if (list) list.innerHTML = sessions.length
        ? sessions.map(session => sessionRow(session, customerId)).join('')
        : '<div class="customer-record-empty"><strong>No connected sessions</strong><span>Sessions will appear when a JA Group Services website reports a real signed-in device.</span></div>';
      const header = panel.querySelector('header');
      if (header && canWrite() && !header.querySelector('[data-central-sessions-revoke-all]')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button danger small';
        button.dataset.centralSessionsRevokeAll = 'true';
        button.dataset.customerId = customerId;
        button.textContent = 'Revoke all live sessions';
        header.append(button);
      }
    } catch (error) {
      if (list) list.innerHTML = `<div class="customer-record-empty"><strong>Central sessions unavailable</strong><span>${html(error.message || 'The session register could not be loaded.')}</span></div>`;
    }
  }

  async function revokeOne(button) {
    const customerId = button.dataset.customerId;
    const sessionId = button.dataset.centralSessionRevoke;
    if (!customerId || !sessionId || !window.confirm('Revoke this customer session? The connected website will sign the device out on its next session check.')) return;
    button.disabled = true;
    try {
      await window.api(`/api/customers/${encodeURIComponent(customerId)}/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'POST', body: JSON.stringify({ reason: 'Head Office manually revoked the selected connected session.' }), timeoutMs: 12_000,
      });
      window.toast?.('Session revocation requested', 'The connected website will deny this session on its next check.');
      await enhance(customerId);
    } catch (error) {
      window.toast?.('Session could not be revoked', error.message, 'error');
      button.disabled = false;
    }
  }

  async function revokeAll(button) {
    const customerId = button.dataset.customerId;
    if (!customerId || !window.confirm('Revoke every active connected session for this customer?')) return;
    button.disabled = true;
    try {
      const result = await window.api(`/api/customers/${encodeURIComponent(customerId)}/sessions`, {
        method: 'POST', body: JSON.stringify({ action: 'revoke_all', reason: 'Head Office manually revoked all connected customer sessions.' }), timeoutMs: 12_000,
      });
      window.toast?.('All sessions marked for revocation', `${Number(result.changed || 0)} active session${Number(result.changed || 0) === 1 ? '' : 's'} affected.`);
      await enhance(customerId);
    } catch (error) {
      window.toast?.('Sessions could not be revoked', error.message, 'error');
      button.disabled = false;
    }
  }

  function install() {
    if (installed || typeof window.renderCustomerRecordWorkspace !== 'function') return false;
    installed = true;
    const original = window.renderCustomerRecordWorkspace;
    window.renderCustomerRecordWorkspace = async function renderCustomerRecordWithSessions(id) {
      const result = await original(id);
      await enhance(id);
      return result;
    };
    return true;
  }

  document.addEventListener('click', event => {
    const one = event.target.closest?.('[data-central-session-revoke]');
    if (one) { event.preventDefault(); event.stopImmediatePropagation(); void revokeOne(one); return; }
    const all = event.target.closest?.('[data-central-sessions-revoke-all]');
    if (all) { event.preventDefault(); event.stopImmediatePropagation(); void revokeAll(all); }
  }, true);

  const timer = window.setInterval(() => {
    if (install()) window.clearInterval(timer);
  }, 200);
  window.setTimeout(() => window.clearInterval(timer), 30_000);
})();
