let centralPlatformRecords = [];

function centralPlatformIntegrations(value) {
  const entries = Object.entries(value && typeof value === 'object' ? value : {});
  if (!entries.length) return '<span class="integration-pill">No integrations configured</span>';
  return entries.map(([key,status]) => `<span class="integration-pill">${escapeHtml(label(key))}: ${escapeHtml(label(String(status)))}</span>`).join('');
}

function centralPlatformCard(platform) {
  const health = platform.health_status || (platform.status === 'active' ? 'operational' : platform.status === 'setup' ? 'awaiting_connection' : platform.status);
  const lastContact = platform.last_heartbeat_at || platform.last_api_activity_at || platform.last_health_check_at;
  const release = platform.release_version || platform.release_commit || 'Not reported';
  const copy = platform.health_message || (health === 'awaiting_connection'
    ? 'The system is registered but has not sent its first secure heartbeat.'
    : 'The system is exchanging live operational and security information with Head Office.');
  return `<article class="platform-card">
    <header class="platform-card-header">
      <div class="platform-card-title"><div class="mini-avatar">${escapeHtml(platform.code.slice(0,2).toUpperCase())}</div><div><h2>${escapeHtml(platform.name)}</h2><p>${escapeHtml(platform.code)} · ${escapeHtml(platform.environment || 'production')}</p></div></div>
      ${tag(health)}
    </header>
    <p>${escapeHtml(copy)}</p>
    <div class="platform-facts">
      <div class="platform-fact"><span>Website</span><strong>${escapeHtml(platform.public_url || 'Not configured')}</strong></div>
      <div class="platform-fact"><span>Hosting</span><strong>${escapeHtml(platform.hosting_provider || 'Not configured')}</strong></div>
      <div class="platform-fact"><span>Release</span><strong class="mono">${escapeHtml(release)}</strong></div>
      <div class="platform-fact"><span>Customers</span><strong>${Number(platform.customer_count || 0).toLocaleString('en-GB')}</strong></div>
      <div class="platform-fact"><span>Live sessions</span><strong>${Number(platform.active_session_count || 0).toLocaleString('en-GB')}</strong></div>
      <div class="platform-fact"><span>Open errors</span><strong>${Number(platform.open_error_count || 0).toLocaleString('en-GB')}</strong></div>
      <div class="platform-fact"><span>Last heartbeat</span><strong>${formatDate(lastContact,'No heartbeat')}</strong></div>
      <div class="platform-fact"><span>Last deployment</span><strong>${formatDate(platform.last_deployment_at,'Not reported')}</strong></div>
      <div class="platform-fact"><span>Customer sync</span><strong>${formatDate(platform.last_customer_sync_at,'No customer sync')}</strong></div>
    </div>
    <div class="integration-list">${centralPlatformIntegrations(platform.integrations)}</div>
    ${hasPermission('platforms:write') ? `<div class="platform-card-actions">
      <button class="button secondary small" data-action="edit-platform" data-id="${escapeHtml(platform.id)}">Edit configuration</button>
      <button class="button secondary small" data-action="generate-key" data-id="${escapeHtml(platform.id)}" data-name="${escapeHtml(platform.name)}">Generate connector key</button>
      <button class="button danger small" data-action="delete-platform" data-id="${escapeHtml(platform.id)}">Delete configuration</button>
    </div>` : ''}
  </article>`;
}

function platformConfigurationForm(platform = {}) {
  const capabilities = Array.isArray(platform.capabilities) ? platform.capabilities.join('\n') : '';
  const integrations = JSON.stringify(platform.integrations && typeof platform.integrations === 'object' ? platform.integrations : {}, null, 2);
  const status = platform.status || 'setup';
  const environment = platform.environment || 'production';
  const health = platform.health_status || 'awaiting_connection';
  return `<div class="form-grid">
    <label class="field"><span>System name</span><input name="name" maxlength="120" value="${escapeHtml(platform.name || '')}" required></label>
    <label class="field"><span>System code</span><input name="code" maxlength="40" pattern="[A-Za-z0-9_-]+" value="${escapeHtml(platform.code || '')}" placeholder="PLANYX" required></label>
    <label class="field full"><span>Public website URL</span><input name="publicUrl" type="url" maxlength="500" value="${escapeHtml(platform.public_url || '')}" placeholder="https://example.jagroupservices.co.uk"></label>
    <label class="field"><span>Environment</span><select name="environment">${['production','preview','staging','development','test'].map(value => `<option value="${value}" ${environment === value ? 'selected' : ''}>${label(value)}</option>`).join('')}</select></label>
    <label class="field"><span>Hosting provider</span><input name="hostingProvider" maxlength="120" value="${escapeHtml(platform.hosting_provider || '')}" placeholder="Cloudflare Pages, GoDaddy, other…"></label>
    ${platform.id ? `<label class="field"><span>System status</span><select name="status">${['setup','active','degraded','offline'].map(value => `<option value="${value}" ${status === value ? 'selected' : ''}>${label(value)}</option>`).join('')}</select></label>` : ''}
    <label class="field"><span>Health status</span><select name="healthStatus">${['awaiting_connection','operational','degraded','maintenance','offline'].map(value => `<option value="${value}" ${health === value ? 'selected' : ''}>${label(value)}</option>`).join('')}</select></label>
    <label class="field"><span>Release version</span><input name="releaseVersion" maxlength="120" value="${escapeHtml(platform.release_version || '')}" placeholder="v1.0.0"></label>
    <label class="field"><span>Release commit</span><input name="releaseCommit" maxlength="120" value="${escapeHtml(platform.release_commit || '')}" placeholder="Commit SHA or release ID"></label>
    <label class="field full"><span>Status message</span><textarea name="healthMessage" maxlength="1000" placeholder="Describe the current connection or setup state.">${escapeHtml(platform.health_message || '')}</textarea></label>
    <label class="field full"><span>Capabilities</span><textarea name="capabilities" placeholder="One capability per line, for example:&#10;customer_identity&#10;security_enforcement&#10;subscriptions">${escapeHtml(capabilities)}</textarea><small>Use one capability per line.</small></label>
    <label class="field full"><span>Integrations</span><textarea name="integrationsJson" class="mono" spellcheck="false">${escapeHtml(integrations)}</textarea><small>Advanced JSON object, for example {&quot;stripe&quot;:&quot;connected&quot;}.</small></label>
  </div>`;
}

renderPlatforms = async function renderCentralConnectedSystems() {
  const data = await api('/api/platforms');
  const platforms = data.platforms || [];
  centralPlatformRecords = platforms;
  const operational = platforms.filter(item => (item.health_status || item.status) === 'operational' || item.status === 'active').length;
  const awaiting = platforms.filter(item => (item.health_status || '') === 'awaiting_connection' || item.status === 'setup').length;
  const errors = platforms.reduce((total,item) => total + Number(item.open_error_count || 0),0);
  const customers = platforms.reduce((total,item) => total + Number(item.customer_count || 0),0);
  $('#viewRoot').innerHTML = `<div class="page-heading"><div><p class="eyebrow">Central customer platform</p><h1>Connected websites &amp; services</h1><p>Register and manage each real JA Group Services website or service. Nothing is assumed automatically: its URL, hosting, environment, integrations and connection state are controlled here.</p></div>${hasPermission('platforms:write') ? '<button class="button primary" data-action="register-platform">Register connected system</button>' : ''}</div>
    <section class="metrics" aria-label="Connected platform summary">
      <article class="metric-card"><span>Registered platforms</span><strong>${platforms.length}</strong><small>Current customer-facing systems</small></article>
      <article class="metric-card"><span>Operational</span><strong>${operational}</strong><small>${awaiting} awaiting connection</small></article>
      <article class="metric-card"><span>Reported customers</span><strong>${customers.toLocaleString('en-GB')}</strong><small>Website totals, not duplicate UCNs</small></article>
      <article class="metric-card"><span>Open website errors</span><strong>${errors.toLocaleString('en-GB')}</strong><small>Reported by connected services</small></article>
    </section>
    <div class="notice"><span>🔐</span><div><strong>Head Office remains authoritative</strong><br>Websites report customer activity and enforce Head Office decisions. They cannot issue UCNs or lift Head Office restrictions.</div></div>
    <section class="platform-grid">${platforms.length ? platforms.map(centralPlatformCard).join('') : emptyState('No connected systems registered','Register a real customer-facing website or service. No platform details are created or guessed automatically.')}</section>`;
};

document.addEventListener('click', event => {
  const element = event.target.closest('[data-action]');
  if (!element) return;
  const action = element.dataset.action;
  if (!['register-platform','edit-platform','delete-platform','generate-key'].includes(action)) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  if (action === 'register-platform') {
    return modalForm('Register connected system', 'Enter the real configuration for this website or service. Nothing is filled from assumptions.', {
      form: 'register-platform',
      html: platformConfigurationForm()
    }, 'Register system', 'Connected websites & services');
  }

  const platform = centralPlatformRecords.find(item => item.id === element.dataset.id);
  if (!platform) return toast('Configuration unavailable', 'Reload the page and try again.', 'error');

  if (action === 'edit-platform') {
    return modalForm('Edit connected-system configuration', `Update the controlled Head Office configuration for ${platform.name}.`, {
      form: 'edit-platform',
      attributes: `data-id="${escapeHtml(platform.id)}"`,
      html: platformConfigurationForm(platform)
    }, 'Save configuration', 'Connected websites & services');
  }

  if (action === 'delete-platform') {
    return modalForm('Delete connected-system configuration', `This removes ${platform.name} from the active connected-systems list, revokes its connector keys and cancels pending instructions. Historical audit evidence is retained.`, {
      form: 'delete-platform',
      attributes: `data-id="${escapeHtml(platform.id)}"`,
      html: `<div class="notice danger"><span>!</span><div><strong>This cannot be undone from this screen</strong><br>Enter the exact system name or code to confirm deletion.</div></div>
        <label class="field"><span>Enter “${escapeHtml(platform.name)}” or “${escapeHtml(platform.code)}”</span><input name="confirmation" autocomplete="off" required></label>`
    }, 'Delete configuration', 'Controlled deletion', true);
  }

  return modalForm('Generate connector key', `Issue a scoped production credential for ${platform.name}.`, {
    form: 'generate-key',
    attributes: `data-id="${escapeHtml(platform.id)}"`,
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
