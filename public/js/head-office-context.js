// The portal has one operating authority: JA Group Services Ltd — Head Office.
// Divisions and services remain record sources and integrations, not staff contexts.

(function loadHeadOfficeShellBehaviour() {
  // The transferred Planyx design now owns the entire visual shell. Retain only
  // the compatibility behaviour from clean-shell.js; loading clean-shell.css
  // here would place the old visual layer after and override the new design.
  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('script[data-clean-shell]')) return;
    const script = document.createElement('script');
    script.src = '/js/clean-shell.js?v=20260728-central-1';
    script.async = false;
    script.dataset.cleanShell = 'true';
    document.body.append(script);
  }, { once: true });
})();

renderNavigation = function renderHeadOfficeNavigation() {
  $$('[data-permission]').forEach(item => {
    item.hidden = !hasPermission(item.dataset.permission);
  });

  const legacyContext = $('#operatingContext');
  if (legacyContext) {
    legacyContext.innerHTML = '<option value="HEAD_OFFICE">JA Group Services Ltd — Head Office</option>';
    legacyContext.value = 'HEAD_OFFICE';
    legacyContext.disabled = true;
    legacyContext.hidden = true;
    legacyContext.setAttribute('aria-hidden', 'true');
  }
};

// This compatibility renderer is replaced later by central-platform-ui.js.
// Keeping a safe fallback means the section remains usable if an enhancement
// asset is ever unavailable.
renderPlatforms = async function renderConnectedSystemsFallback() {
  const data = await api('/api/platforms');
  const rows = data.platforms.length
    ? data.platforms.map(platform => `<tr><td><div class="primary-cell"><div class="mini-avatar">${escapeHtml(platform.code.slice(0,2).toUpperCase())}</div><div><strong>${escapeHtml(platform.name)}</strong><small>${escapeHtml(platform.code)}</small></div></div></td><td>${tag(platform.health_status || platform.status)}</td><td>${Number(platform.active_credential_count || 0)}</td><td>${formatDate(platform.last_heartbeat_at || platform.last_api_activity_at || platform.last_health_check_at, 'No activity')}</td><td>${hasPermission('platforms:write') ? `<button class="button secondary small" data-action="generate-key" data-id="${platform.id}" data-name="${escapeHtml(platform.name)}">Generate key</button>` : ''}</td></tr>`).join('')
    : `<tr><td colspan="5">${emptyState('No connected systems registered', 'Register a website or service when it needs to exchange customer and security data with Head Office.')}</td></tr>`;

  $('#viewRoot').innerHTML = `<div class="page-heading"><div><p class="eyebrow">Central platform control</p><h1>Connected websites &amp; services</h1><p>Manage secure system-to-system connections, website health and Head Office enforcement.</p></div>${hasPermission('platforms:write') ? '<button class="button primary" data-action="register-platform">Register connected system</button>' : ''}</div><section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Connected system</th><th>Status</th><th>Active keys</th><th>Last contact</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
};
