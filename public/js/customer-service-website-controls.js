(() => {
  const API = '/api/support-centre/website-controls';
  const ORDER = ['ja-group-services', 'ja-domain-hub', 'planyx', 'profile-centre'];
  let profiles = [];
  let busy = false;

  const escape = value => window.escapeHtml ? window.escapeHtml(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const checked = value => value ? 'checked' : '';
  const selected = (value, expected) => String(value || '') === expected ? 'selected' : '';

  async function request(path = '', options = {}) {
    const response = await fetch(`${API}${path ? `/${path}` : ''}`, {
      credentials: 'include',
      cache: 'no-store',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || payload?.error || payload?.message || 'Website controls are temporarily unavailable.');
    return payload;
  }

  async function loadProfiles() {
    const data = await request();
    profiles = data.profiles || [];
    return profiles;
  }

  function statusLabel(profile) {
    if (!profile.registered && !profile.platformId) return 'Platform record missing';
    if (profile.connected) return 'Connected to Head Office';
    if (profile.connectionStatus === 'never_connected') return 'Awaiting website connection';
    return profile.connectionStatus || 'Connection not confirmed';
  }

  function statusClass(profile) {
    if (profile.connected) return 'connected';
    if (!profile.platformId) return 'missing';
    return 'pending';
  }

  function profileStrip(profile) {
    return `<div class="full-control-profile-strip ${statusClass(profile)}">
      <span>${escape(statusLabel(profile))}</span>
      <span>Assistant: ${profile.assistantEnabled ? 'On' : 'Off'}</span>
      <span>AI: ${profile.aiEnabled ? 'On' : 'Off'}</span>
      <span>Launch gate: ${profile.launchGate?.enabled ? 'On' : 'Off'}</span>
    </div>`;
  }

  function missingCard(profile) {
    return `<article class="support-branch-card full-control-missing-card" data-full-profile="${escape(profile.key)}">
      <header><div><span class="eyebrow">Required website profile</span><h2>${escape(profile.expectedName)}</h2><p>Not yet registered in Connected Websites &amp; Services.</p></div><span class="support-tag disabled">Missing</span></header>
      <div class="support-branch-notice"><strong>Connection required</strong><span>Create or restore the platform record before issuing a scoped Head Office credential. No website infrastructure setting has been changed.</span></div>
    </article>`;
  }

  function enhanceBranchGrid() {
    if (!location.hash.includes('customer-service-centre')) return;
    const grid = document.querySelector('.support-branch-grid');
    if (!grid || grid.dataset.fullControlsEnhanced === 'true') return;
    grid.dataset.fullControlsEnhanced = 'true';

    for (const profile of profiles) {
      if (!profile.platformId) continue;
      const button = grid.querySelector(`[data-support-configure="${CSS.escape(profile.platformId)}"]`);
      const card = button?.closest('.support-branch-card');
      if (!card) continue;
      card.dataset.fullProfile = profile.key;
      card.style.order = String(ORDER.indexOf(profile.key) + 1);
      card.querySelector('.full-control-profile-strip')?.remove();
      card.insertAdjacentHTML('beforeend', profileStrip(profile));
      if (button) button.textContent = 'Open full website controls';
    }

    for (const key of ORDER) {
      const profile = profiles.find(item => item.key === key);
      if (profile && !profile.platformId) grid.insertAdjacentHTML('beforeend', missingCard(profile));
    }
  }

  function textArea(name, label, value, rows = 2, maximum = 1600) {
    return `<label class="field full-span"><span>${escape(label)}</span><textarea name="${escape(name)}" rows="${rows}" maxlength="${maximum}">${escape(value || '')}</textarea></label>`;
  }

  function section(title, description, body) {
    return `<fieldset class="full-control-section"><legend>${escape(title)}</legend><p>${escape(description)}</p><div class="full-control-fields">${body}</div></fieldset>`;
  }

  function branchForm(profile) {
    const appearance = profile.appearance || {};
    const escalation = profile.escalationRules || {};
    const contacts = profile.contactOptions || {};
    const hours = profile.operatingHours || {};
    const gate = profile.launchGate || {};
    const domain = profile.key === 'ja-domain-hub';

    return `<form data-full-support-profile-form data-platform-id="${escape(profile.platformId)}">
      <div class="full-control-summary">
        <strong>${escape(profile.platformName)}</strong>
        <span>${escape(statusLabel(profile))}</span>
        <small>Last website contact: ${escape(profile.lastSeenAt || 'Not recorded')}</small>
      </div>

      ${section('Availability and handling', 'Control whether customers can open the assistant and how conversations are handled.', `
        <label><input type="checkbox" name="assistantEnabled" ${checked(profile.assistantEnabled)}> Customer assistant enabled</label>
        <label><input type="checkbox" name="aiEnabled" ${checked(profile.aiEnabled)}> AI responses enabled</label>
        <label><input type="checkbox" name="humanTakeoverEnabled" ${checked(profile.humanTakeoverEnabled)}> Human takeover enabled</label>
        <label><input type="checkbox" name="anonymousEnabled" ${checked(profile.anonymousEnabled)}> Anonymous general enquiries</label>
        <label><input type="checkbox" name="maintenanceEnabled" ${checked(profile.maintenanceEnabled)}> Support maintenance mode</label>
        <label><input type="checkbox" name="showKnowledgeSuggestions" ${checked(appearance.showKnowledgeSuggestions !== false)}> Knowledge suggestions</label>
        <label class="field"><span>Assistant name</span><input name="assistantName" maxlength="120" value="${escape(profile.assistantName || '')}" required></label>
        <label class="field"><span>Conversation retention (days)</span><input name="retentionDays" type="number" min="30" max="2555" value="${Number(profile.retentionDays || 180)}" required></label>
      `)}

      ${section('Messages and customer wording', 'These messages are applied to this website only.', `
        ${textArea('greeting', 'Greeting', profile.greeting)}
        ${textArea('awayMessage', 'Away message', profile.awayMessage)}
        ${textArea('maintenanceMessage', 'Support maintenance message', profile.maintenanceMessage)}
        ${textArea('emergencyNotice', 'Emergency notice', profile.emergencyNotice)}
        <label class="field full-span"><span>Input placeholder</span><input name="inputPlaceholder" maxlength="120" value="${escape(appearance.inputPlaceholder || 'Type your enquiry…')}"></label>
        <label class="field"><span>Launcher label</span><input name="launcherLabel" maxlength="60" value="${escape(appearance.launcherLabel || 'Help')}"></label>
        <label class="field"><span>Header subtitle</span><input name="headerSubtitle" maxlength="160" value="${escape(appearance.headerSubtitle || 'Managed by JA Group Services Head Office')}"></label>
      `)}

      ${section('Appearance and design', 'Control the assistant design independently for this website.', `
        <label class="field"><span>Accent colour</span><input name="accentColour" type="color" value="${escape(appearance.accentColour || '#2563eb')}"></label>
        <label class="field"><span>Launcher colour</span><input name="launcherColour" type="color" value="${escape(appearance.launcherColour || '#2563eb')}"></label>
        <label class="field"><span>Header background</span><input name="headerBackground" type="color" value="${escape(appearance.headerBackground || '#0f172a')}"></label>
        <label class="field"><span>Header text</span><input name="headerTextColour" type="color" value="${escape(appearance.headerTextColour || '#ffffff')}"></label>
        <label class="field"><span>Panel background</span><input name="panelBackground" type="color" value="${escape(appearance.panelBackground || '#ffffff')}"></label>
        <label class="field"><span>Panel text</span><input name="panelTextColour" type="color" value="${escape(appearance.panelTextColour || '#0f172a')}"></label>
        <label class="field"><span>Position</span><select name="position"><option value="bottom-right" ${selected(appearance.position, 'bottom-right')}>Bottom right</option><option value="bottom-left" ${selected(appearance.position, 'bottom-left')}>Bottom left</option></select></label>
        <label class="field"><span>Theme</span><select name="theme"><option value="auto" ${selected(appearance.theme || 'auto', 'auto')}>Automatic</option><option value="light" ${selected(appearance.theme, 'light')}>Light</option><option value="dark" ${selected(appearance.theme, 'dark')}>Dark</option></select></label>
        <label class="field"><span>Message style</span><select name="messageStyle"><option value="rounded" ${selected(appearance.messageStyle || 'rounded', 'rounded')}>Rounded</option><option value="compact" ${selected(appearance.messageStyle, 'compact')}>Compact</option><option value="square" ${selected(appearance.messageStyle, 'square')}>Square</option></select></label>
        <label class="field"><span>Panel width</span><input name="panelWidth" type="number" min="320" max="720" value="${Number(appearance.panelWidth || 430)}"></label>
        <label class="field"><span>Panel height</span><input name="panelHeight" type="number" min="420" max="900" value="${Number(appearance.panelHeight || 680)}"></label>
        <label class="field"><span>Corner radius</span><input name="borderRadius" type="number" min="0" max="36" value="${Number(appearance.borderRadius ?? 18)}"></label>
        <label class="field"><span>Launcher size</span><input name="launcherSize" type="number" min="44" max="82" value="${Number(appearance.launcherSize || 56)}"></label>
        <label><input type="checkbox" name="showLauncherLabel" ${checked(appearance.showLauncherLabel !== false)}> Show launcher label</label>
        <label><input type="checkbox" name="showPoweredBy" ${checked(appearance.showPoweredBy !== false)}> Show Head Office subtitle</label>
      `)}

      ${section('Operating hours and contact routes', 'Set the customer-facing availability and official contact channels.', `
        <label class="field"><span>Opening time</span><input name="openTime" type="time" value="${escape(hours.openTime || '09:00')}"></label>
        <label class="field"><span>Closing time</span><input name="closeTime" type="time" value="${escape(hours.closeTime || '17:00')}"></label>
        <label><input type="checkbox" name="monday" ${checked(hours.monday !== false)}> Monday</label>
        <label><input type="checkbox" name="tuesday" ${checked(hours.tuesday !== false)}> Tuesday</label>
        <label><input type="checkbox" name="wednesday" ${checked(hours.wednesday !== false)}> Wednesday</label>
        <label><input type="checkbox" name="thursday" ${checked(hours.thursday !== false)}> Thursday</label>
        <label><input type="checkbox" name="friday" ${checked(hours.friday !== false)}> Friday</label>
        <label><input type="checkbox" name="saturday" ${checked(hours.saturday === true)}> Saturday</label>
        <label><input type="checkbox" name="sunday" ${checked(hours.sunday === true)}> Sunday</label>
        <label class="field"><span>Public email</span><input name="contactEmail" type="email" value="${escape(contacts.email || 'contact@jagroupservices.co.uk')}"></label>
        <label class="field"><span>Telephone</span><input name="contactPhone" value="${escape(contacts.phone || '020 3834 2790')}"></label>
        <label class="field"><span>Complaints email</span><input name="complaintsEmail" type="email" value="${escape(contacts.complaintsEmail || 'complaints@jagroupservices.co.uk')}"></label>
        <label class="field"><span>Data protection email</span><input name="dataProtectionEmail" type="email" value="${escape(contacts.dataProtectionEmail || 'dataprotection@jagroupservices.co.uk')}"></label>
      `)}

      ${section('Escalation and safeguards', 'Apply automatic Head Office routing rules. Restricted matters remain human-only.', `
        <label><input type="checkbox" name="complaintEscalation" ${checked(escalation.complaintEscalation !== false)}> Route complaints to complaints handling</label>
        <label><input type="checkbox" name="dataProtectionEscalation" ${checked(escalation.dataProtectionEscalation !== false)}> Route data protection to DPO</label>
        <label><input type="checkbox" name="safeguardingEscalation" ${checked(escalation.safeguardingEscalation !== false)}> Immediate safeguarding escalation</label>
        <label><input type="checkbox" name="securityEscalation" ${checked(escalation.securityEscalation !== false)}> Immediate security escalation</label>
        <label><input type="checkbox" name="fraudEscalation" ${checked(escalation.fraudEscalation !== false)}> Flag suspected fraud</label>
        <label><input type="checkbox" name="accountChangeVerification" ${checked(escalation.accountChangeVerification !== false)}> Require verification for account changes</label>
        <label><input type="checkbox" name="providerEscalation" ${checked(escalation.providerEscalation !== false)}> Allow provider escalation records</label>
        ${domain ? '<label><input type="checkbox" name="selfServiceFirst" checked> Require guided self-troubleshooting before ordinary adviser escalation</label>' : ''}
        <label class="field"><span>AI confidence threshold (%)</span><input name="confidenceThreshold" type="number" min="50" max="100" value="${Number(escalation.confidenceThreshold || 80)}"></label>
        <label class="field"><span>Maximum AI turns before adviser offer</span><input name="maxAiTurns" type="number" min="1" max="30" value="${Number(escalation.maxAiTurns || 8)}"></label>
      `)}

      ${section('Website launch gate', 'This is a separate website-level control. It does not change DNS, deployment, authentication or routing settings.', `
        <label><input type="checkbox" name="launchGateEnabled" ${checked(gate.enabled)}> Launch gate enabled</label>
        <label><input type="checkbox" name="showCompanyDetails" ${checked(gate.showCompanyDetails !== false)}> Show company details</label>
        <label><input type="checkbox" name="allowSearchEngines" ${checked(gate.allowSearchEngines)}> Allow search-engine indexing</label>
        <label class="field"><span>Gate mode</span><select name="launchGateMode"><option value="prelaunch" ${selected(gate.mode || 'prelaunch', 'prelaunch')}>Pre-launch</option><option value="maintenance" ${selected(gate.mode, 'maintenance')}>Maintenance</option><option value="temporarily_unavailable" ${selected(gate.mode, 'temporarily_unavailable')}>Temporarily unavailable</option><option value="private_preview" ${selected(gate.mode, 'private_preview')}>Private preview</option></select></label>
        <label class="field"><span>Background</span><input name="launchGateBackground" type="color" value="${escape(gate.background || '#081426')}"></label>
        <label class="field"><span>Accent</span><input name="launchGateAccent" type="color" value="${escape(gate.accent || '#2563eb')}"></label>
        <label class="field"><span>Text colour</span><input name="launchGateTextColour" type="color" value="${escape(gate.textColour || '#ffffff')}"></label>
        <label class="field full-span"><span>Title</span><input name="launchGateTitle" maxlength="180" value="${escape(gate.title || profile.platformName)}"></label>
        ${textArea('launchGateMessage', 'Launch-gate message', gate.message, 3)}
        <label class="field"><span>Button label</span><input name="launchGateCtaLabel" maxlength="120" value="${escape(gate.ctaLabel || 'Contact JA Group Services')}"></label>
        <label class="field"><span>Button link</span><input name="launchGateCtaHref" maxlength="500" value="${escape(gate.ctaHref || 'mailto:contact@jagroupservices.co.uk')}"></label>
      `)}

      <p class="form-error"></p>
      <div class="form-actions full-control-actions"><button type="button" class="button secondary" data-close-modal>Cancel</button><button class="button primary" type="submit">Save all controls</button></div>
    </form>`;
  }

  async function openFullControls(platformId) {
    try {
      const data = await request(encodeURIComponent(platformId));
      const profile = data.profile;
      if (!profile) throw new Error('The website control profile could not be loaded.');
      window.openModal?.('Full website customer-service controls', `${profile.platformName} · independent Head Office profile`, branchForm(profile), 'AI Customer Service Centre');
    } catch (error) {
      window.toast?.('Website controls unavailable', error.message, 'error');
    }
  }

  function checkbox(form, name, fallback = false) {
    const element = form.elements.namedItem(name);
    return element instanceof HTMLInputElement ? element.checked : fallback;
  }

  function value(form, name) {
    const element = form.elements.namedItem(name);
    return element && 'value' in element ? String(element.value || '') : '';
  }

  async function save(form) {
    if (busy) return;
    busy = true;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    const platformId = form.dataset.platformId;
    const payload = {
      assistantName: value(form, 'assistantName'),
      assistantEnabled: checkbox(form, 'assistantEnabled'),
      aiEnabled: checkbox(form, 'aiEnabled'),
      humanTakeoverEnabled: checkbox(form, 'humanTakeoverEnabled'),
      anonymousEnabled: checkbox(form, 'anonymousEnabled'),
      maintenanceEnabled: checkbox(form, 'maintenanceEnabled'),
      greeting: value(form, 'greeting'),
      awayMessage: value(form, 'awayMessage'),
      maintenanceMessage: value(form, 'maintenanceMessage'),
      emergencyNotice: value(form, 'emergencyNotice'),
      retentionDays: Number(value(form, 'retentionDays')),
      operatingHours: {
        openTime: value(form, 'openTime'), closeTime: value(form, 'closeTime'),
        monday: checkbox(form, 'monday'), tuesday: checkbox(form, 'tuesday'), wednesday: checkbox(form, 'wednesday'),
        thursday: checkbox(form, 'thursday'), friday: checkbox(form, 'friday'), saturday: checkbox(form, 'saturday'), sunday: checkbox(form, 'sunday'),
        timezone: 'Europe/London',
      },
      appearance: {
        accentColour: value(form, 'accentColour'), launcherColour: value(form, 'launcherColour'),
        headerBackground: value(form, 'headerBackground'), headerTextColour: value(form, 'headerTextColour'),
        panelBackground: value(form, 'panelBackground'), panelTextColour: value(form, 'panelTextColour'),
        position: value(form, 'position'), theme: value(form, 'theme'), messageStyle: value(form, 'messageStyle'),
        panelWidth: Number(value(form, 'panelWidth')), panelHeight: Number(value(form, 'panelHeight')),
        borderRadius: Number(value(form, 'borderRadius')), launcherSize: Number(value(form, 'launcherSize')),
        launcherLabel: value(form, 'launcherLabel'), headerSubtitle: value(form, 'headerSubtitle'),
        inputPlaceholder: value(form, 'inputPlaceholder'), showLauncherLabel: checkbox(form, 'showLauncherLabel'),
        showPoweredBy: checkbox(form, 'showPoweredBy'), showKnowledgeSuggestions: checkbox(form, 'showKnowledgeSuggestions'),
      },
      escalationRules: {
        complaintEscalation: checkbox(form, 'complaintEscalation'), dataProtectionEscalation: checkbox(form, 'dataProtectionEscalation'),
        safeguardingEscalation: checkbox(form, 'safeguardingEscalation'), securityEscalation: checkbox(form, 'securityEscalation'),
        fraudEscalation: checkbox(form, 'fraudEscalation'), accountChangeVerification: checkbox(form, 'accountChangeVerification'),
        providerEscalation: checkbox(form, 'providerEscalation'), selfServiceFirst: checkbox(form, 'selfServiceFirst'),
        confidenceThreshold: Number(value(form, 'confidenceThreshold')), maxAiTurns: Number(value(form, 'maxAiTurns')),
      },
      contactOptions: {
        email: value(form, 'contactEmail'), phone: value(form, 'contactPhone'),
        complaintsEmail: value(form, 'complaintsEmail'), dataProtectionEmail: value(form, 'dataProtectionEmail'),
        showEmail: true, showPhone: true,
      },
      launchGate: {
        enabled: checkbox(form, 'launchGateEnabled'), mode: value(form, 'launchGateMode'),
        title: value(form, 'launchGateTitle'), message: value(form, 'launchGateMessage'),
        ctaLabel: value(form, 'launchGateCtaLabel'), ctaHref: value(form, 'launchGateCtaHref'),
        background: value(form, 'launchGateBackground'), accent: value(form, 'launchGateAccent'),
        textColour: value(form, 'launchGateTextColour'), showCompanyDetails: checkbox(form, 'showCompanyDetails'),
        allowSearchEngines: checkbox(form, 'allowSearchEngines'),
      },
    };

    try {
      await request(encodeURIComponent(platformId), { method: 'PUT', body: JSON.stringify(payload) });
      window.closeModal?.();
      window.toast?.('Website controls saved', 'The assistant, design, escalation and launch-gate settings were recorded in the Head Office audit history.');
      await loadProfiles();
      document.querySelector('.support-branch-grid')?.removeAttribute('data-full-controls-enhanced');
      enhanceBranchGrid();
    } catch (error) {
      const output = form.querySelector('.form-error');
      if (output) output.textContent = error.message;
    } finally {
      busy = false;
      if (submit) submit.disabled = false;
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-support-configure]');
    if (!button) return;
    const platformId = button.dataset.supportConfigure;
    setTimeout(() => openFullControls(platformId), 0);
  }, true);

  document.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-full-support-profile-form]');
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    save(form);
  }, true);

  const observer = new MutationObserver(() => enhanceBranchGrid());
  const begin = async () => {
    try { await loadProfiles(); } catch { return; }
    const root = document.getElementById('viewRoot');
    if (root) observer.observe(root, { childList: true, subtree: true });
    enhanceBranchGrid();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin, { once: true });
  else begin();
})();
