(() => {
  const ROUTE = 'customer-service-controls';
  const state = { branches: [], busy: false };
  let installed = false;

  const html = value => window.escapeHtml
    ? window.escapeHtml(value ?? '')
    : String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const checked = value => value ? 'checked' : '';
  const selected = (value, expected) => String(value ?? '') === String(expected) ? 'selected' : '';
  const fieldValue = (form, name) => form.elements.namedItem(name)?.value ?? '';
  const checkboxValue = (form, name) => Boolean(form.elements.namedItem(name)?.checked);
  const currentRoute = () => String(window.routeFromHash?.() || location.hash.replace(/^#\/?/, '') || 'dashboard');
  const partsFor = route => String(route || '').split('/').filter(Boolean).map(part => decodeURIComponent(part));

  function statusTag(status) {
    const normalised = String(status || 'unknown').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    return `<span class="csc-control-status ${html(normalised)}">${html(String(status || 'unknown').replaceAll('_', ' '))}</span>`;
  }

  function connectionCopy(branch) {
    const status = branch.connection?.status || 'never_connected';
    if (status === 'connected') return 'Live connection confirmed';
    if (status === 'degraded') return 'The website has not checked in recently';
    if (status === 'disconnected') return 'The website connection appears offline';
    if (status === 'not_registered') return 'The central website record is missing';
    return 'Generate a connection key and add it to the website’s Cloudflare project.';
  }

  async function loadBranches() {
    const data = await window.api('/api/support-controls/branches', { timeoutMs: 12_000 });
    state.branches = data.branches || [];
    return state.branches;
  }

  function routeFor(branch) {
    return `${ROUTE}/${encodeURIComponent(branch.slotKey)}`;
  }

  function branchFromRoute(route) {
    const parts = partsFor(route);
    const key = parts[1];
    if (!key) return null;
    return state.branches.find(branch => branch.slotKey === key || branch.platformId === key) || null;
  }

  function cardActions(branch) {
    if (!branch.registered) return '<button type="button" class="button secondary" disabled>Platform record required</button>';
    return `<div class="form-actions">
      <button type="button" class="button primary" data-csc-manage="${html(branch.slotKey)}">Open ${html(branch.slotLabel)} controls</button>
      <button type="button" class="button secondary" data-csc-generate-key="${html(branch.platformId)}" data-csc-slot="${html(branch.slotKey)}" data-csc-name="${html(branch.slotLabel)}">Generate connection key</button>
    </div>`;
  }

  function branchCard(branch) {
    const enabled = branch.registered && branch.assistantEnabled;
    return `<article class="csc-branch-control-card" data-branch-slot="${html(branch.slotKey)}">
      <header>
        <div><p class="eyebrow">${html(branch.slotLabel)}</p><h2>${html(branch.platformName || branch.slotLabel)}</h2><span>${html(branch.assistantName || 'Customer Service branch')}</span></div>
        ${statusTag(enabled ? 'enabled' : branch.registered ? 'disabled' : 'not_registered')}
      </header>
      <dl>
        <div><dt>Head Office connection</dt><dd>${statusTag(branch.connection?.status || 'never_connected')}<small>${html(connectionCopy(branch))}</small></dd></div>
        <div><dt>AI responses</dt><dd>${branch.aiEnabled ? 'Enabled' : 'Disabled'}</dd></div>
        <div><dt>Human takeover</dt><dd>${branch.humanTakeoverEnabled ? 'Enabled' : 'Disabled'}</dd></div>
        <div><dt>Maintenance</dt><dd>${branch.maintenanceEnabled ? 'Active' : 'Not active'}</dd></div>
        ${branch.launchGateSupported ? `<div><dt>JA Group Services Launch Gate</dt><dd>${branch.launchGate?.enabled ? 'ACTIVE' : 'Off'}</dd></div>` : ''}
      </dl>
      <footer>${cardActions(branch)}</footer>
    </article>`;
  }

  async function renderList() {
    window.setLoading?.('Opening website customer-service controls…');
    try {
      await loadBranches();
      if (partsFor(currentRoute())[0] !== ROUTE) return;
      document.getElementById('viewRoot').innerHTML = `<div class="page-heading">
        <div><p class="eyebrow">JA Group Services Ltd · Head Office controlled systems</p><h1>Website Customer Service Controls</h1><p>Separate controls for JA Group Services, JA Domain Hub, Planyx and Profile Centre.</p></div>
        <div class="heading-actions"><button type="button" class="button secondary" data-route="customer-service-centre">Live conversations</button><button type="button" class="button secondary" data-csc-refresh>Refresh status</button></div>
      </div>
      <div class="notice"><span>i</span><div><strong>Safe control boundary</strong><br>These controls do not change DNS, authentication, payments, databases, customer accounts or website deployment settings.</div></div>
      <section class="csc-branch-control-grid">${state.branches.map(branchCard).join('')}</section>`;
    } catch (error) {
      document.getElementById('viewRoot').innerHTML = `<section class="panel"><div class="empty-state"><strong>Website controls could not be opened</strong><span>${html(error.message)}</span></div></section>`;
      window.toast?.('Website controls unavailable', error.message, 'error');
    }
  }

  function colourField(name, labelText, value) {
    return `<label class="field"><span>${html(labelText)}</span><div class="csc-colour-field"><input type="color" name="${html(name)}" value="${html(value)}"><input type="text" value="${html(value)}" data-colour-text="${html(name)}" maxlength="7" pattern="#[0-9A-Fa-f]{6}"></div></label>`;
  }

  function dayField(name, labelText, value) {
    return `<label class="field"><span>${html(labelText)}</span><input name="${html(name)}" value="${html(value || '')}" placeholder="09:00–17:00 or Closed"></label>`;
  }

  function preview(branch) {
    const appearance = branch.appearance || {};
    return `<aside class="csc-design-preview" style="--preview-accent:${html(appearance.accentColour)};--preview-launcher:${html(appearance.launcherColour)};--preview-launcher-text:${html(appearance.launcherTextColour)};--preview-header:${html(appearance.headerBackground)};--preview-header-text:${html(appearance.headerTextColour)};--preview-panel:${html(appearance.panelBackground)};--preview-panel-text:${html(appearance.panelTextColour)};--preview-radius:${Number(appearance.borderRadius || 18)}px;--preview-width:${Math.min(Number(appearance.panelWidth || 430), 470)}px">
      <p class="eyebrow">Live design preview</p>
      <div class="csc-preview-window"><header><strong data-preview-name>${html(branch.assistantName)}</strong><span data-preview-subtitle>${html(appearance.headerSubtitle)}</span></header><main><div class="csc-preview-message">${html(branch.greeting || 'Customer Service greeting')}</div><div class="csc-preview-message customer">Example customer message</div></main><footer><span data-preview-placeholder>${html(appearance.inputPlaceholder)}</span><b>Send</b></footer></div>
      <div class="csc-preview-launcher">${html(appearance.launcherLabel || 'Help')}</div>
    </aside>`;
  }

  function launchGatePanel(branch) {
    if (!branch.launchGateSupported) return '';
    const gate = branch.launchGate || {};
    return `<section class="panel csc-launch-gate-panel"><div class="panel-header"><div><h2>JA Group Services Launch Gate</h2><p>Priority public-website control. It applies only to the JA Group Services website.</p></div>${statusTag(gate.enabled ? 'active' : 'off')}</div><div class="panel-body">
      <div class="notice danger"><span>!</span><div><strong>Public website control</strong><br>Turning this on replaces the public JA Group Services content with the approved gate. It remains fail-open if Head Office is unavailable.</div></div>
      <label class="csc-launch-toggle"><input type="checkbox" name="launchGateEnabled" ${checked(gate.enabled)}> <strong>Enable the JA Group Services Launch Gate</strong></label>
      <div class="form-grid"><label class="field"><span>Gate mode</span><select name="launchGateMode"><option value="prelaunch" ${selected(gate.mode, 'prelaunch')}>Pre-launch</option><option value="maintenance" ${selected(gate.mode, 'maintenance')}>Maintenance</option><option value="temporarily_unavailable" ${selected(gate.mode, 'temporarily_unavailable')}>Temporarily unavailable</option><option value="private_preview" ${selected(gate.mode, 'private_preview')}>Private preview</option></select></label><label class="field"><span>Title</span><input name="launchGateTitle" maxlength="160" value="${html(gate.title || 'JA Group Services')}"></label></div>
      <label class="field"><span>Public message</span><textarea name="launchGateMessage" rows="4" maxlength="1500">${html(gate.message || '')}</textarea></label>
      <div class="form-grid"><label class="field"><span>Button label</span><input name="launchGateCtaLabel" maxlength="100" value="${html(gate.ctaLabel || 'Contact JA Group Services')}"></label><label class="field"><span>Button destination</span><input name="launchGateCtaHref" maxlength="500" value="${html(gate.ctaHref || 'mailto:contact@jagroupservices.co.uk')}"></label>${colourField('launchGateBackground', 'Background', gate.background || '#081426')}${colourField('launchGateAccent', 'Accent', gate.accent || '#2563eb')}${colourField('launchGateTextColour', 'Text colour', gate.textColour || '#ffffff')}</div>
      <div class="csc-toggle-grid"><label><input type="checkbox" name="launchGateShowCompanyDetails" ${checked(gate.showCompanyDetails)}> Show Company number and registered office</label><label><input type="checkbox" name="launchGateAllowSearchEngines" ${checked(gate.allowSearchEngines)}> Allow search-engine indexing while gated</label></div>
    </div></section>`;
  }

  function connectionPanel(branch) {
    return `<section class="panel"><div class="panel-header"><div><h2>Head Office connection</h2><p>Generate the website key here. The secret is shown once only.</p></div>${statusTag(branch.connection?.status || 'never_connected')}</div><div class="panel-body">
      <dl class="csc-connection-evidence"><div><dt>Status</dt><dd>${statusTag(branch.connection?.status || 'never_connected')}</dd></div><div><dt>Last seen</dt><dd>${html(branch.connection?.lastSeenAt ? window.formatDate?.(branch.connection.lastSeenAt) || branch.connection.lastSeenAt : 'Never')}</dd></div><div><dt>Origin</dt><dd class="mono">${html(branch.connection?.lastOrigin || 'Not supplied')}</dd></div><div><dt>Last error</dt><dd>${html(branch.connection?.lastErrorCode || 'None recorded')}</dd></div></dl>
      <div class="notice"><span>i</span><div><strong>Cloudflare secret name</strong><br><code>CUSTOMEROPS_API_KEY</code></div></div>
      <button type="button" class="button primary" data-csc-generate-key="${html(branch.platformId)}" data-csc-slot="${html(branch.slotKey)}" data-csc-name="${html(branch.slotLabel)}">Generate connection key</button>
    </div></section>`;
  }

  function renderEditor(branch) {
    const appearance = branch.appearance || {};
    const hours = branch.operatingHours || {};
    const escalation = branch.escalationRules || {};
    const contacts = branch.contactOptions || {};
    document.getElementById('viewRoot').innerHTML = `<div class="page-heading"><div><button type="button" class="csc-back" data-csc-back>← All website controls</button><p class="eyebrow">${html(branch.slotLabel)} · ${html(branch.platformCode || '')}</p><h1>${html(branch.slotLabel)} Customer Service</h1><p>Head Office control of availability, AI, adviser takeover, design, escalation and retention for this website only.</p></div><div class="heading-actions">${statusTag(branch.connection?.status || 'never_connected')}</div></div>
    <div class="csc-editor-layout"><form class="csc-control-form" data-csc-control-form data-platform-id="${html(branch.platformId)}">
      ${launchGatePanel(branch)}
      ${connectionPanel(branch)}
      <section class="panel"><div class="panel-header"><div><h2>Availability and handling</h2><p>Turn this website’s Customer Service functions on or off without changing the website itself.</p></div></div><div class="panel-body"><div class="csc-toggle-grid"><label><input type="checkbox" name="assistantEnabled" ${checked(branch.assistantEnabled)}> Customer Service launcher enabled</label><label><input type="checkbox" name="aiEnabled" ${checked(branch.aiEnabled)}> AI responses enabled</label><label><input type="checkbox" name="humanTakeoverEnabled" ${checked(branch.humanTakeoverEnabled)}> Head Office human takeover enabled</label><label><input type="checkbox" name="anonymousEnabled" ${checked(branch.anonymousEnabled)}> Anonymous general enquiries allowed</label><label><input type="checkbox" name="maintenanceEnabled" ${checked(branch.maintenanceEnabled)}> Customer Service maintenance mode</label></div><div class="form-grid"><label class="field"><span>Assistant name</span><input name="assistantName" maxlength="120" value="${html(branch.assistantName)}" required></label><label class="field"><span>Conversation retention</span><input name="retentionDays" type="number" min="30" max="2555" value="${Number(branch.retentionDays || 180)}" required></label></div></div></section>
      <section class="panel"><div class="panel-header"><div><h2>Customer messages</h2><p>Website-specific wording.</p></div></div><div class="panel-body"><label class="field"><span>Greeting</span><textarea name="greeting" rows="3" maxlength="1000">${html(branch.greeting)}</textarea></label><label class="field"><span>Away message</span><textarea name="awayMessage" rows="3" maxlength="1000">${html(branch.awayMessage)}</textarea></label><label class="field"><span>Maintenance message</span><textarea name="maintenanceMessage" rows="3" maxlength="1000">${html(branch.maintenanceMessage)}</textarea></label><label class="field"><span>Emergency notice</span><textarea name="emergencyNotice" rows="3" maxlength="1000">${html(branch.emergencyNotice)}</textarea></label></div></section>
      <section class="panel"><div class="panel-header"><div><h2>Design and appearance</h2><p>These controls change only the Customer Service window.</p></div></div><div class="panel-body"><div class="form-grid">${colourField('accentColour', 'Accent colour', appearance.accentColour)}${colourField('launcherColour', 'Launcher colour', appearance.launcherColour)}${colourField('launcherTextColour', 'Launcher text colour', appearance.launcherTextColour)}${colourField('headerBackground', 'Header background', appearance.headerBackground)}${colourField('headerTextColour', 'Header text colour', appearance.headerTextColour)}${colourField('panelBackground', 'Panel background', appearance.panelBackground)}${colourField('panelTextColour', 'Panel text colour', appearance.panelTextColour)}<label class="field"><span>Launcher position</span><select name="position"><option value="bottom-right" ${selected(appearance.position, 'bottom-right')}>Bottom right</option><option value="bottom-left" ${selected(appearance.position, 'bottom-left')}>Bottom left</option></select></label><label class="field"><span>Theme</span><select name="theme"><option value="auto" ${selected(appearance.theme, 'auto')}>Follow website</option><option value="light" ${selected(appearance.theme, 'light')}>Light</option><option value="dark" ${selected(appearance.theme, 'dark')}>Dark</option></select></label><label class="field"><span>Message style</span><select name="messageStyle"><option value="rounded" ${selected(appearance.messageStyle, 'rounded')}>Rounded</option><option value="compact" ${selected(appearance.messageStyle, 'compact')}>Compact</option><option value="square" ${selected(appearance.messageStyle, 'square')}>Square</option></select></label><label class="field"><span>Panel width</span><input name="panelWidth" type="number" min="340" max="720" value="${Number(appearance.panelWidth || 430)}"></label><label class="field"><span>Panel height</span><input name="panelHeight" type="number" min="480" max="900" value="${Number(appearance.panelHeight || 680)}"></label><label class="field"><span>Corner radius</span><input name="borderRadius" type="number" min="0" max="32" value="${Number(appearance.borderRadius || 18)}"></label><label class="field"><span>Launcher size</span><input name="launcherSize" type="number" min="44" max="80" value="${Number(appearance.launcherSize || 56)}"></label><label class="field"><span>Launcher label</span><input name="launcherLabel" maxlength="80" value="${html(appearance.launcherLabel || 'Help')}"></label><label class="field"><span>Header subtitle</span><input name="headerSubtitle" maxlength="160" value="${html(appearance.headerSubtitle || '')}"></label><label class="field full"><span>Input placeholder</span><input name="inputPlaceholder" maxlength="160" value="${html(appearance.inputPlaceholder || '')}"></label></div><div class="csc-toggle-grid"><label><input type="checkbox" name="showLauncherLabel" ${checked(appearance.showLauncherLabel)}> Show launcher label</label><label><input type="checkbox" name="showPoweredBy" ${checked(appearance.showPoweredBy)}> Show Head Office attribution</label><label><input type="checkbox" name="showKnowledgeSuggestions" ${checked(appearance.showKnowledgeSuggestions)}> Show knowledge suggestions</label></div><label class="field csc-small-field"><span>Maximum knowledge suggestions</span><input name="knowledgeLimit" type="number" min="0" max="10" value="${Number(appearance.knowledgeLimit ?? 3)}"></label></div></section>
      <section class="panel"><div class="panel-header"><div><h2>Contact routes</h2></div></div><div class="panel-body"><div class="form-grid"><label class="field"><span>General contact email</span><input name="contactEmail" type="email" value="${html(contacts.email || 'contact@jagroupservices.co.uk')}"></label><label class="field"><span>Main telephone</span><input name="contactPhone" value="${html(contacts.phone || '020 3834 2790')}"></label><label class="field"><span>Complaints email</span><input name="complaintsEmail" type="email" value="${html(contacts.complaintsEmail || 'complaints@jagroupservices.co.uk')}"></label><label class="field"><span>Data protection email</span><input name="dataProtectionEmail" type="email" value="${html(contacts.dataProtectionEmail || 'dataprotection@jagroupservices.co.uk')}"></label></div><div class="csc-toggle-grid"><label><input type="checkbox" name="showEmail" ${checked(contacts.showEmail)}> Show email</label><label><input type="checkbox" name="showPhone" ${checked(contacts.showPhone)}> Show telephone</label></div></div></section>
      <section class="panel"><div class="panel-header"><div><h2>Operating hours</h2></div></div><div class="panel-body"><div class="form-grid"><label class="field"><span>Timezone</span><input name="timezone" value="${html(hours.timezone || 'Europe/London')}"></label><label class="field"><span>Closed message</span><input name="closedMessage" value="${html(hours.closedMessage || '')}"></label>${dayField('monday', 'Monday', hours.monday)}${dayField('tuesday', 'Tuesday', hours.tuesday)}${dayField('wednesday', 'Wednesday', hours.wednesday)}${dayField('thursday', 'Thursday', hours.thursday)}${dayField('friday', 'Friday', hours.friday)}${dayField('saturday', 'Saturday', hours.saturday)}${dayField('sunday', 'Sunday', hours.sunday)}</div><div class="csc-toggle-grid"><label><input type="checkbox" name="displayHoursToCustomer" ${checked(hours.displayHoursToCustomer)}> Display hours to customers</label></div></div></section>
      <section class="panel"><div class="panel-header"><div><h2>Escalation and safety rules</h2></div></div><div class="panel-body"><div class="csc-toggle-grid"><label><input type="checkbox" name="escalateComplaints" ${checked(escalation.complaints)}> Escalate complaints</label><label><input type="checkbox" name="escalateDataProtection" ${checked(escalation.dataProtection)}> Escalate data protection</label><label><input type="checkbox" name="escalateSafeguarding" ${checked(escalation.safeguarding)}> Escalate safeguarding</label><label><input type="checkbox" name="escalateSecurity" ${checked(escalation.security)}> Escalate security and fraud</label><label><input type="checkbox" name="escalateAccountRecovery" ${checked(escalation.accountRecovery)}> Escalate account recovery</label><label><input type="checkbox" name="providerEscalation" ${checked(escalation.providerEscalation)}> Allow provider escalation workflow</label><label><input type="checkbox" name="requireConsentForSensitiveData" ${checked(escalation.requireConsentForSensitiveData)}> Require consent before sensitive-data collection</label></div><div class="form-grid"><label class="field"><span>Unresolved-message threshold</span><input name="unresolvedAfterMessages" type="number" min="1" max="20" value="${Number(escalation.unresolvedAfterMessages || 5)}"></label><label class="field"><span>Human request priority</span><select name="humanRequestPriority"><option value="low" ${selected(escalation.humanRequestPriority, 'low')}>Low</option><option value="normal" ${selected(escalation.humanRequestPriority, 'normal')}>Normal</option><option value="high" ${selected(escalation.humanRequestPriority, 'high')}>High</option><option value="critical" ${selected(escalation.humanRequestPriority, 'critical')}>Critical</option></select></label></div></div></section>
      <div class="csc-save-bar"><p class="form-error" data-csc-form-error></p><button type="button" class="button secondary" data-csc-back>Cancel</button><button class="button primary" type="submit">Save ${html(branch.slotLabel)} controls</button></div>
    </form>${preview(branch)}</div>`;
    bindPreview();
  }

  async function renderRoute(route) {
    const parts = partsFor(route);
    if (parts[0] !== ROUTE) return false;
    window.setLoading?.('Opening website customer-service controls…');
    try {
      await loadBranches();
      const branch = branchFromRoute(route);
      if (parts[1] && !branch) {
        window.toast?.('Website profile not found', 'The selected website profile could not be opened.', 'error');
        return window.navigate?.(ROUTE);
      }
      if (branch) renderEditor(branch);
      else await renderList();
    } catch (error) {
      document.getElementById('viewRoot').innerHTML = `<section class="panel"><div class="empty-state"><strong>Website controls could not be opened</strong><span>${html(error.message)}</span></div></section>`;
    }
    return true;
  }

  function bindPreview() {
    const form = document.querySelector('[data-csc-control-form]');
    const previewElement = document.querySelector('.csc-design-preview');
    if (!form || !previewElement) return;
    const refresh = () => {
      const styles = { '--preview-accent': fieldValue(form, 'accentColour'), '--preview-launcher': fieldValue(form, 'launcherColour'), '--preview-launcher-text': fieldValue(form, 'launcherTextColour'), '--preview-header': fieldValue(form, 'headerBackground'), '--preview-header-text': fieldValue(form, 'headerTextColour'), '--preview-panel': fieldValue(form, 'panelBackground'), '--preview-panel-text': fieldValue(form, 'panelTextColour'), '--preview-radius': `${fieldValue(form, 'borderRadius') || 18}px`, '--preview-width': `${Math.min(Number(fieldValue(form, 'panelWidth') || 430), 470)}px` };
      for (const [name, value] of Object.entries(styles)) previewElement.style.setProperty(name, value);
      previewElement.querySelector('[data-preview-name]').textContent = fieldValue(form, 'assistantName');
      previewElement.querySelector('[data-preview-subtitle]').textContent = fieldValue(form, 'headerSubtitle');
      previewElement.querySelector('[data-preview-placeholder]').textContent = fieldValue(form, 'inputPlaceholder');
      previewElement.querySelector('.csc-preview-launcher').textContent = checkboxValue(form, 'showLauncherLabel') ? fieldValue(form, 'launcherLabel') : '●';
    };
    form.addEventListener('input', refresh);
  }

  function payloadFromForm(form) {
    return {
      assistantName: fieldValue(form, 'assistantName'), assistantEnabled: checkboxValue(form, 'assistantEnabled'), aiEnabled: checkboxValue(form, 'aiEnabled'), humanTakeoverEnabled: checkboxValue(form, 'humanTakeoverEnabled'), anonymousEnabled: checkboxValue(form, 'anonymousEnabled'), maintenanceEnabled: checkboxValue(form, 'maintenanceEnabled'), maintenanceMessage: fieldValue(form, 'maintenanceMessage'), emergencyNotice: fieldValue(form, 'emergencyNotice'), greeting: fieldValue(form, 'greeting'), awayMessage: fieldValue(form, 'awayMessage'), retentionDays: Number(fieldValue(form, 'retentionDays')),
      appearance: { accentColour: fieldValue(form, 'accentColour'), launcherColour: fieldValue(form, 'launcherColour'), launcherTextColour: fieldValue(form, 'launcherTextColour'), headerBackground: fieldValue(form, 'headerBackground'), headerTextColour: fieldValue(form, 'headerTextColour'), panelBackground: fieldValue(form, 'panelBackground'), panelTextColour: fieldValue(form, 'panelTextColour'), position: fieldValue(form, 'position'), theme: fieldValue(form, 'theme'), messageStyle: fieldValue(form, 'messageStyle'), panelWidth: Number(fieldValue(form, 'panelWidth')), panelHeight: Number(fieldValue(form, 'panelHeight')), borderRadius: Number(fieldValue(form, 'borderRadius')), launcherSize: Number(fieldValue(form, 'launcherSize')), launcherLabel: fieldValue(form, 'launcherLabel'), headerSubtitle: fieldValue(form, 'headerSubtitle'), inputPlaceholder: fieldValue(form, 'inputPlaceholder'), showLauncherLabel: checkboxValue(form, 'showLauncherLabel'), showPoweredBy: checkboxValue(form, 'showPoweredBy'), showKnowledgeSuggestions: checkboxValue(form, 'showKnowledgeSuggestions'), knowledgeLimit: Number(fieldValue(form, 'knowledgeLimit')) },
      contactOptions: { email: fieldValue(form, 'contactEmail'), phone: fieldValue(form, 'contactPhone'), complaintsEmail: fieldValue(form, 'complaintsEmail'), dataProtectionEmail: fieldValue(form, 'dataProtectionEmail'), showEmail: checkboxValue(form, 'showEmail'), showPhone: checkboxValue(form, 'showPhone') },
      operatingHours: { timezone: fieldValue(form, 'timezone'), closedMessage: fieldValue(form, 'closedMessage'), monday: fieldValue(form, 'monday'), tuesday: fieldValue(form, 'tuesday'), wednesday: fieldValue(form, 'wednesday'), thursday: fieldValue(form, 'thursday'), friday: fieldValue(form, 'friday'), saturday: fieldValue(form, 'saturday'), sunday: fieldValue(form, 'sunday'), displayHoursToCustomer: checkboxValue(form, 'displayHoursToCustomer') },
      escalationRules: { complaints: checkboxValue(form, 'escalateComplaints'), dataProtection: checkboxValue(form, 'escalateDataProtection'), safeguarding: checkboxValue(form, 'escalateSafeguarding'), security: checkboxValue(form, 'escalateSecurity'), accountRecovery: checkboxValue(form, 'escalateAccountRecovery'), providerEscalation: checkboxValue(form, 'providerEscalation'), requireConsentForSensitiveData: checkboxValue(form, 'requireConsentForSensitiveData'), unresolvedAfterMessages: Number(fieldValue(form, 'unresolvedAfterMessages')), humanRequestPriority: fieldValue(form, 'humanRequestPriority') },
      launchGate: { enabled: checkboxValue(form, 'launchGateEnabled'), mode: fieldValue(form, 'launchGateMode'), title: fieldValue(form, 'launchGateTitle'), message: fieldValue(form, 'launchGateMessage'), ctaLabel: fieldValue(form, 'launchGateCtaLabel'), ctaHref: fieldValue(form, 'launchGateCtaHref'), background: fieldValue(form, 'launchGateBackground'), accent: fieldValue(form, 'launchGateAccent'), textColour: fieldValue(form, 'launchGateTextColour'), showCompanyDetails: checkboxValue(form, 'launchGateShowCompanyDetails'), allowSearchEngines: checkboxValue(form, 'launchGateAllowSearchEngines') },
    };
  }

  async function saveControls(form) {
    if (state.busy) return;
    state.busy = true;
    const submitButton = form.querySelector('button[type="submit"]');
    const errorElement = form.querySelector('[data-csc-form-error]');
    if (submitButton) submitButton.disabled = true;
    if (errorElement) errorElement.textContent = '';
    try {
      const data = await window.api(`/api/support-controls/branches/${encodeURIComponent(form.dataset.platformId)}`, { method: 'PUT', body: JSON.stringify(payloadFromForm(form)), timeoutMs: 15_000 });
      const index = state.branches.findIndex(branch => branch.platformId === data.branch.platformId);
      if (index >= 0) state.branches[index] = data.branch;
      window.toast?.(`${data.branch.slotLabel} controls saved`, 'The change was recorded in the Head Office audit history.');
      renderEditor(data.branch);
    } catch (error) {
      if (errorElement) errorElement.textContent = error.message;
      window.toast?.('Controls could not be saved', error.message, 'error');
    } finally {
      state.busy = false;
      if (submitButton) submitButton.disabled = false;
    }
  }

  function openKeyGenerator(button) {
    const platformId = button.dataset.cscGenerateKey;
    const slot = button.dataset.cscSlot || '';
    const name = button.dataset.cscName || 'Website';
    window.openModal?.('Generate website connection key', `${name} · Head Office Customer Service connection`, `<form data-csc-key-form data-platform-id="${html(platformId)}" data-slot="${html(slot)}" data-name="${html(name)}"><div class="notice danger"><span>!</span><div><strong>The key is shown once only</strong><br>Do not email it or place it in GitHub.</div></div><label class="field"><span>Credential name</span><input name="name" maxlength="100" value="${html(`${name} production Customer Service`)}" required></label><div class="notice"><span>i</span><div>After generation, add the value to the correct Cloudflare project as an encrypted Production secret named <code>CUSTOMEROPS_API_KEY</code>.</div></div><p class="form-error"></p><div class="form-actions"><button type="button" class="button secondary" data-close-modal>Cancel</button><button type="submit" class="button primary">Generate key</button></div></form>`, 'Secure platform credential');
  }

  async function generateKey(form) {
    const platformId = form.dataset.platformId;
    const slot = form.dataset.slot;
    const name = fieldValue(form, 'name');
    const scopes = ['support:read', 'support:write', ...(slot === 'planyx' ? ['support:ai'] : [])];
    const errorElement = form.querySelector('.form-error');
    try {
      const result = await window.api(`/api/platforms/${encodeURIComponent(platformId)}/credentials`, { method: 'POST', body: JSON.stringify({ name, scopes }), timeoutMs: 15_000 });
      window.openModal?.('Copy the connection key now', 'This secret cannot be viewed again after this window is closed.', `<div class="notice danger"><span>!</span><div><strong>One-time secret</strong><br>Add this value to the relevant Cloudflare website project. Do not send it by email or commit it to source control.</div></div><label class="field"><span>Cloudflare secret name</span><input value="CUSTOMEROPS_API_KEY" readonly></label><pre class="key-output" id="generatedKey">${html(result.credential.token)}</pre><div class="form-actions"><button class="button primary" data-action="copy-key">Copy key</button><button class="button secondary" data-close-modal>Close</button></div>`, 'Platform credential');
    } catch (error) {
      if (errorElement) errorElement.textContent = error.message;
    }
  }

  function addNavigation() {
    const nav = document.getElementById('mainNavigation');
    if (!nav || nav.querySelector(`[data-route="${ROUTE}"]`)) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'nav-item'; button.dataset.route = ROUTE; button.dataset.permission = 'configuration:read'; button.textContent = 'Website Customer Service Controls';
    const anchor = nav.querySelector('[data-route="customer-service-centre"]') || nav.querySelector('[data-route="communications"]');
    if (anchor?.parentElement) anchor.parentElement.insertBefore(button, anchor.nextSibling); else nav.append(button);
    window.renderNavigation?.();
  }

  function install() {
    if (installed || typeof window.renderRoute !== 'function' || typeof window.navigate !== 'function') return false;
    installed = true;
    const originalRenderRoute = window.renderRoute;
    window.renderRoute = async function customerServiceControlledRoute(route = currentRoute()) {
      if (partsFor(route)[0] === ROUTE) return renderRoute(route);
      return originalRenderRoute(route);
    };
    addNavigation();
    if (partsFor(currentRoute())[0] === ROUTE) window.renderRoute(currentRoute());
    return true;
  }

  document.addEventListener('click', event => {
    const manage = event.target.closest?.('[data-csc-manage]');
    if (manage) { event.preventDefault(); event.stopImmediatePropagation(); return window.navigate(routeFor({ slotKey: manage.dataset.cscManage })); }
    if (event.target.closest?.('[data-csc-back]')) { event.preventDefault(); event.stopImmediatePropagation(); return window.navigate(ROUTE); }
    if (event.target.closest?.('[data-csc-refresh]')) { event.preventDefault(); event.stopImmediatePropagation(); return window.renderRoute(currentRoute()); }
    const keyButton = event.target.closest?.('[data-csc-generate-key]');
    if (keyButton) { event.preventDefault(); event.stopImmediatePropagation(); return openKeyGenerator(keyButton); }
  }, true);

  document.addEventListener('submit', event => {
    const controls = event.target.closest?.('[data-csc-control-form]');
    if (controls) { event.preventDefault(); event.stopImmediatePropagation(); return saveControls(controls); }
    const keyForm = event.target.closest?.('[data-csc-key-form]');
    if (keyForm) { event.preventDefault(); event.stopImmediatePropagation(); return generateKey(keyForm); }
  }, true);

  const timer = window.setInterval(() => {
    const appShell = document.getElementById('appShell');
    if (!appShell || appShell.hidden) return;
    if (install()) window.clearInterval(timer);
  }, 250);
  window.setTimeout(() => window.clearInterval(timer), 30_000);
})();
