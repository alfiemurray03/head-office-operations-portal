function centralPlatformIntegrations(value) {
  const entries = Object.entries(value && typeof value === 'object' ? value : {});
  if (!entries.length) return '<span class="integration-pill">No integrations reported</span>';
  return entries.map(([key,status]) => `<span class="integration-pill">${escapeHtml(label(key))}: ${escapeHtml(label(String(status)))}</span>`).join('');
}

function centralPlatformCard(platform) {
  const health = platform.health_status || (platform.status === 'active' ? 'operational' : platform.status === 'setup' ? 'awaiting_connection' : platform.status);
  const lastContact = platform.last_heartbeat_at || platform.last_api_activity_at || platform.last_health_check_at;
  const release = platform.release_version || platform.release_commit || 'Not reported';
  const copy = platform.health_message || (health === 'awaiting_connection'
    ? 'The Head Office configuration is ready. The website has not sent its first secure heartbeat yet.'
    : 'Live website data and security instructions are exchanged with Head Office.');
  return `<article class="platform-card">
    <header class="platform-card-header">
      <div class="platform-card-title"><div class="mini-avatar">${escapeHtml(platform.code.slice(0,2).toUpperCase())}</div><div><h2>${escapeHtml(platform.name)}</h2><p>${escapeHtml(platform.code)} · ${escapeHtml(platform.environment || 'production')}</p></div></div>
      ${tag(health)}
    </header>
    <p>${escapeHtml(copy)}</p>
    <div class="platform-facts">
      <div class="platform-fact"><span>Website</span><strong>${escapeHtml(platform.public_url || 'Not reported')}</strong></div>
      <div class="platform-fact"><span>Hosting</span><strong>${escapeHtml(platform.hosting_provider || 'Not reported')}</strong></div>
      <div class="platform-fact"><span>Release</span><strong class="mono">${escapeHtml(release)}</strong></div>
      <div class="platform-fact"><span>Customers</span><strong>${Number(platform.customer_count || 0).toLocaleString('en-GB')}</strong></div>
      <div class="platform-fact"><span>Live sessions</span><strong>${Number(platform.active_session_count || 0).toLocaleString('en-GB')}</strong></div>
      <div class="platform-fact"><span>Open errors</span><strong>${Number(platform.open_error_count || 0).toLocaleString('en-GB')}</strong></div>
      <div class="platform-fact"><span>Last heartbeat</span><strong>${formatDate(lastContact,'No heartbeat')}</strong></div>
      <div class="platform-fact"><span>Last deployment</span><strong>${formatDate(platform.last_deployment_at,'Not reported')}</strong></div>
      <div class="platform-fact"><span>Customer sync</span><strong>${formatDate(platform.last_customer_sync_at,'No customer sync')}</strong></div>
    </div>
    <div class="integration-list">${centralPlatformIntegrations(platform.integrations)}</div>
    <div class="form-actions">
      ${hasPermission('platforms:write') ? `<button class="button secondary small" data-action="generate-key" data-id="${escapeHtml(platform.id)}" data-name="${escapeHtml(platform.name)}">Generate connector key</button>` : ''}
    </div>
  </article>`;
}

renderPlatforms = async function renderCentralConnectedSystems() {
  const data = await api('/api/platforms');
  const platforms = data.platforms || [];
  const operational = platforms.filter(item => (item.health_status || item.status) === 'operational' || item.status === 'active').length;
  const awaiting = platforms.filter(item => (item.health_status || '') === 'awaiting_connection' || item.status === 'setup').length;
  const errors = platforms.reduce((total,item) => total + Number(item.open_error_count || 0),0);
  const customers = platforms.reduce((total,item) => total + Number(item.customer_count || 0),0);
  $('#viewRoot').innerHTML = `<div class="page-heading"><div><p class="eyebrow">Central customer platform</p><h1>Connected websites &amp; services</h1><p>Live website health, deployment, customer, security and integration information. Profile Centre is preconfigured and remains clearly marked as awaiting connection until its GoDaddy connector is activated.</p></div>${hasPermission('platforms:write') ? '<button class="button primary" data-action="register-platform">Register connected system</button>' : ''}</div>
    <section class="metrics" aria-label="Connected platform summary">
      <article class="metric-card"><span>Registered platforms</span><strong>${platforms.length}</strong><small>Present and future customer services</small></article>
      <article class="metric-card"><span>Operational</span><strong>${operational}</strong><small>${awaiting} awaiting connection</small></article>
      <article class="metric-card"><span>Reported customers</span><strong>${customers.toLocaleString('en-GB')}</strong><small>Website totals, not duplicate UCNs</small></article>
      <article class="metric-card"><span>Open website errors</span><strong>${errors.toLocaleString('en-GB')}</strong><small>Reported by connected services</small></article>
    </section>
    <div class="notice"><span>🔐</span><div><strong>Head Office remains authoritative</strong><br>Websites report customer activity and enforce Head Office decisions. They cannot issue UCNs or lift Head Office restrictions.</div></div>
    <section class="platform-grid">${platforms.length ? platforms.map(centralPlatformCard).join('') : emptyState('No platforms registered','Register a customer-facing website or service to begin secure data exchange.')}</section>`;
};

document.addEventListener('click', event => {
  const element = event.target.closest('[data-action="generate-key"]');
  if (!element) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  return modalForm('Generate connector key', `Issue a scoped production credential for ${element.dataset.name}.`, {
    form: 'generate-key',
    attributes: `data-id="${escapeHtml(element.dataset.id)}"`,
    html: `<label class="field"><span>Credential name</span><input name="name" maxlength="120" placeholder="Production central connector" required></label>
      <fieldset class="field"><legend>Approved capabilities</legend>
        <label><input type="checkbox" name="scopes" value="customers:read" checked> Read linked universal customer identities</label>
        <label><input type="checkbox" name="scopes" value="customers:write" checked> Register and synchronise customer accounts</label>
        <label><input type="checkbox" name="scopes" value="security:read" checked> Receive restrictions and access decisions</label>
        <label><input type="checkbox" name="scopes" value="events:write" checked> Send activity, payments, orders and security events</label>
        <label><input type="checkbox" name="scopes" value="platform:write" checked> Send website health and deployment information</label>
      </fieldset>`
  }, 'Generate secure key', 'Connected platform credential');
}, true);
