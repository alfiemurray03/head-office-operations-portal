// The portal has one operating authority: JA Group Services Ltd — Head Office.
// Divisions and services remain record sources and integrations, not staff contexts.
renderNavigation = function renderHeadOfficeNavigation() {
  $$('[data-permission]').forEach(item => {
    item.hidden = !hasPermission(item.dataset.permission);
  });

  const legacyContext = $('#operatingContext');
  if (legacyContext) {
    legacyContext.innerHTML = '<option value="HEAD_OFFICE">JA Group Services Ltd — Head Office</option>';
    legacyContext.value = 'HEAD_OFFICE';
    legacyContext.disabled = true;
  }
};

renderPlatforms = async function renderConnectedSystems() {
  const data = await api('/api/platforms');
  const rows = data.platforms.length
    ? data.platforms.map(platform => `<tr><td><div class="primary-cell"><div class="mini-avatar">${escapeHtml(platform.code.slice(0,2).toUpperCase())}</div><div><strong>${escapeHtml(platform.name)}</strong><small>${escapeHtml(platform.code)}</small></div></div></td><td>${tag(platform.status)}</td><td>${Number(platform.active_credential_count || 0)}</td><td>${formatDate(platform.last_api_activity_at || platform.last_health_check_at, 'No activity')}</td><td>${hasPermission('platforms:write') ? `<button class="button secondary small" data-action="generate-key" data-id="${platform.id}" data-name="${escapeHtml(platform.name)}">Generate key</button>` : ''}</td></tr>`).join('')
    : `<tr><td colspan="5">${emptyState('No connected systems registered', 'Head Office access is already active. Register a system only when a division or website needs to exchange data with this portal.')}</td></tr>`;

  $('#viewRoot').innerHTML = `<div class="page-heading"><div><p class="eyebrow">Head Office integration control</p><h1>Connected systems</h1><p>Manage secure system-to-system connections used by divisions and websites. These connections do not create separate staff portals or operating contexts.</p></div>${hasPermission('platforms:write') ? '<button class="button primary" data-action="register-platform">＋ Register connected system</button>' : ''}</div><div class="notice"><span>🏢</span><div><strong>One Head Office portal</strong><br>Only authorised JA Group Services Ltd Head Office staff use this portal. Planyx, Profile Centre, JA Domain Hub and future services connect as data sources and receive controlled instructions through scoped credentials.</div></div><div class="notice"><span>🔑</span><div><strong>Credential security</strong><br>Connector keys are displayed once. Head Office stores only a one-way hash and the approved scopes.</div></div><section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Connected system</th><th>Status</th><th>Active keys</th><th>Last API activity</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
};
