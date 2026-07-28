const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { platforms: [], administration: null, configuration: null };

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/login") showLogin();
    throw new Error(data.error?.message || "The request could not be completed.");
  }
  return data;
}

function showLogin(note = "") {
  document.body.classList.add("locked");
  $("#appShell").hidden = true;
  $("#loginScreen").classList.remove("hidden");
  $("#configurationNote").textContent = note;
}

function showApp(user) {
  document.body.classList.remove("locked");
  $("#loginScreen").classList.add("hidden");
  $("#appShell").hidden = false;
  $("#userName").textContent = user.displayName;
  $("#userRole").textContent = user.roleName;
  $("#userInitials").textContent = user.displayName.split(/\s+/).map(x => x[0]).slice(0, 2).join("").toUpperCase();
}

function showView(id) {
  $$(".view").forEach(view => view.classList.toggle("active", view.id === id));
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === id));
  $("#sidebar").classList.remove("open");
  if (location.hash !== `#/${id}`) history.replaceState({}, "", `#/${id}`);
}

function setEmpty(id, empty) {
  $(id).hidden = !empty;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function renderModules() {
  const modules = {
    communications: ["Customer communications", "One company-wide history of customer contact across Head Office and every division.", [["Inbound queue","Email, web form, telephone and WhatsApp contacts"],["Templates","Head Office-approved responses and notices"],["Preferences","Verified channels, consent and contact restrictions"]]],
    payments: ["Payments and refunds", "Operational oversight of provider references, refund decisions, disputes and approval controls.", [["Payment activity","Cross-division payment references"],["Refund approvals","Manual authority and value limits"],["Disputes","Chargebacks, evidence and outcomes"]]],
    complaints: ["Complaints management", "Formal complaints from receipt and acknowledgement through investigation, decision and closure.", [["Complaint queue","Open, overdue and escalated complaints"],["Response deadlines","Acknowledgement and final-response controls"],["Outcomes","Remedies, learning and recurring issues"]]],
    "data-protection": ["Data protection centre", "Restricted workflows for information rights, incidents, objections and disclosure decisions.", [["Rights requests","Access, erasure, rectification and portability"],["Incident register","Assessment, containment and notification"],["DPO decisions","Restricted advice and recorded outcomes"]]],
    safeguarding: ["Safeguarding centre", "Strictly restricted concern management with enhanced access and disclosure logging.", [["Concern intake","Record and immediately triage concerns"],["Risk actions","Protective action and external referrals"],["Restricted records","Need-to-know access with full audit history"]]]
  };
  for (const [id, [title, copy, sections]] of Object.entries(modules)) {
    $(`#${id}`).innerHTML = `<div class="page-heading"><div><p class="eyebrow">Head Office Customer Operations Centre</p><h1>${title}</h1><p>${copy}</p></div><button class="primary-button">＋ Create record</button></div>
      <div class="section-grid">${sections.map(([heading, text]) => `<article class="panel feature-card"><div class="feature-symbol">→</div><h2>${heading}</h2><p>${text}</p><button class="text-button">Open section</button></article>`).join("")}</div>
      <article class="panel queue-panel"><div class="panel-heading"><div><h2>Current work queue</h2><p>Records for the selected operating context</p></div><span class="tag success">Head Office controlled</span></div><div class="empty-state">No records currently require action in this queue.</div></article>`;
  }
  $("#staff").innerHTML = administrationShell();
  $("#audit").innerHTML = auditShell();
  $("#settings").innerHTML = settingsShell();
}

function administrationShell() {
  return `<div class="page-heading"><div><p class="eyebrow">System administration</p><h1>Staff, roles and authority</h1><p>Microsoft-authenticated staff access, Head Office roles and division operating scope.</p></div><button class="primary-button">＋ Invite staff member</button></div>
    <div class="admin-tabs"><button class="active">Staff directory</button><button>Roles & permissions</button><button>Access reviews</button></div>
    <article class="panel table-panel"><div class="panel-heading"><div><h2>Authorised staff</h2><p>Accounts recognised by the Customer Operations Centre</p></div></div><div class="table-wrap"><table><thead><tr><th>Staff member</th><th>Authentication</th><th>Assigned roles</th><th>Status</th><th>Added</th></tr></thead><tbody id="staffRows"></tbody></table></div><div class="empty-state" id="staffEmpty">No staff records found.</div></article>
    <div class="section-grid" id="roleCards"></div>`;
}

function auditShell() {
  return `<div class="page-heading"><div><p class="eyebrow">Assurance and accountability</p><h1>Audit history</h1><p>Append-only evidence of staff, system and division activity.</p></div><button class="secondary-button">Export authorised report</button></div>
    <article class="panel table-panel"><div class="table-tools"><div class="search wide"><span>⌕</span><input placeholder="Filter by person, action or record…"></div></div><div class="table-wrap"><table><thead><tr><th>Date and time</th><th>Actor</th><th>Action</th><th>Record type</th><th>Reference</th></tr></thead><tbody id="auditRows"></tbody></table></div><div class="empty-state" id="auditEmpty">No audit events recorded.</div></article>`;
}

function settingsShell() {
  return `<div class="page-heading"><div><p class="eyebrow">Governed configuration</p><h1>Centre configuration</h1><p>Company-wide rules used by Head Office and enforced by connected divisions.</p></div></div>
    <div class="settings-layout"><aside class="settings-nav"><button class="active">General</button><button>Security policy</button><button>Case management</button><button>Customer controls</button><button>Notifications</button><button>Reference data</button><button>Retention</button><button>Integrations</button></aside>
    <div><article class="panel settings-panel"><div class="panel-heading"><div><h2>Security and operations policy</h2><p>Changes are recorded in the immutable audit history</p></div></div><form id="settingsForm" class="settings-form">
      <label><span>Staff session duration<small>Hours before staff must authenticate again</small></span><input name="security.session_hours" type="number" min="1" max="24"></label>
      <label><span>Failed sign-in threshold<small>Attempts before the event requires review</small></span><input name="security.failed_login_threshold" type="number" min="3" max="20"></label>
      <label><span>Default marker review period<small>Days until an active marker requires formal review</small></span><input name="security.default_marker_review_days" type="number" min="1" max="365"></label>
      <label><span>Case reference prefix<small>Prefix allocated to new Head Office cases</small></span><input name="operations.case_reference_prefix" maxlength="8"></label>
      <label><span>Critical case alerts<small>Notify authorised Head Office staff immediately</small></span><input name="notifications.critical_case_alerts" type="checkbox"></label>
      <p class="form-status" id="settingsStatus"></p><div class="settings-actions"><button class="primary-button">Save governed configuration</button></div>
    </form></article>
    <article class="panel catalogue-panel"><div class="panel-heading"><div><h2>Security control catalogue</h2><p>Marker and restriction definitions available to authorised staff</p></div></div><div id="securityCatalogue"></div></article></div></div>`;
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  $("#environmentName").textContent = data.environment;
  $("#metricCustomers").textContent = data.metrics.customers;
  $("#metricCases").textContent = data.metrics.openCases;
  $("#metricDue").textContent = `${data.metrics.overdueCases} overdue`;
  $("#metricRestrictions").textContent = data.metrics.activeRestrictions;
  $("#metricPlatforms").textContent = data.metrics.activePlatforms;
  $("#navCustomers").textContent = data.metrics.customers;
  $("#navCases").textContent = data.metrics.openCases;
  $("#navRestrictions").textContent = data.metrics.activeRestrictions;
  state.platforms = data.platforms;
  $("#originatingPlatform").innerHTML = `<option value="">None</option>${data.platforms.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")}`;
  $("#attentionList").innerHTML = data.attention.length ? data.attention.map(c => `<button class="attention-row"><span class="severity ${escapeHtml(c.priority)}"></span><div><strong>${escapeHtml(c.title)}</strong><small>${escapeHtml(c.case_reference)} · ${escapeHtml(c.customer_number || "No customer")}</small></div><div><span class="tag ${escapeHtml(c.priority)}">${escapeHtml(c.priority)}</span><time>${formatDate(c.due_at)}</time></div></button>`).join("") : "No cases currently require attention.";
  $("#platformSummary").innerHTML = data.platforms.length ? data.platforms.map(p => `<div class="platform"><div class="platform-logo">${escapeHtml(p.code.slice(0,2))}</div><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.status)}</small></div><time>${formatDate(p.last_health_check_at)}</time></div>`).join("") : "No platforms are connected yet.";
  $("#activityList").innerHTML = data.activity.length ? data.activity.map(a => `<div class="activity"><div class="activity-icon blue">✓</div><div><strong>${escapeHtml(a.action_label)}</strong><p>${escapeHtml(a.entity_type)} · ${escapeHtml(a.entity_reference || a.entity_id)}</p><small>${escapeHtml(a.actor_name || "System")}</small></div><time>${formatDate(a.occurred_at)}</time></div>`).join("") : "No audited activity has been recorded yet.";
}

async function loadCustomers(query = "") {
  const data = await api(`/api/customers?q=${encodeURIComponent(query)}`);
  $("#customerRows").innerHTML = data.customers.map(c => `<tr><td><div class="customer-cell"><div class="mini-avatar">${escapeHtml(c.initials)}</div><div><strong>${escapeHtml(c.display_name)}</strong><small>${escapeHtml(c.verified_email)}</small></div></div></td><td><strong>${escapeHtml(c.customer_number)}</strong></td><td>${c.platform_count}</td><td><span class="status-dot ${escapeHtml(c.account_status)}"></span>${escapeHtml(c.account_status)}</td><td><span class="tag ${c.security_status === "clear" ? "success" : "review"}">${escapeHtml(c.security_status)}</span></td><td>${formatDate(c.last_activity_at)}</td></tr>`).join("");
  setEmpty("#customerEmpty", data.customers.length === 0);
}

async function loadCases() {
  const data = await api("/api/cases");
  $("#caseRows").innerHTML = data.cases.map(c => `<tr><td><strong>${escapeHtml(c.case_reference)}</strong></td><td>${escapeHtml(c.title)}</td><td>${escapeHtml(c.customer_number || "—")}</td><td>${escapeHtml(c.case_type.replaceAll("_", " "))}</td><td><span class="tag ${escapeHtml(c.priority)}">${escapeHtml(c.priority)}</span></td><td>${escapeHtml(c.status)}</td><td>${formatDate(c.due_at)}</td></tr>`).join("");
  setEmpty("#caseEmpty", data.cases.length === 0);
}

async function loadSecurity() {
  const data = await api("/api/security");
  $("#markerList").innerHTML = data.markers.length ? data.markers.map(m => `<div class="marker"><span class="severity ${escapeHtml(m.risk_level)}"></span><div><strong>${escapeHtml(m.marker_type)}</strong><small>${escapeHtml(m.customer_number)} · review ${formatDate(m.review_at)}</small></div><span class="tag ${escapeHtml(m.risk_level)}">${escapeHtml(m.status)}</span></div>`).join("") : "No active security markers.";
  $("#restrictionList").innerHTML = data.restrictions.length ? data.restrictions.map(r => `<div class="marker"><span class="severity high"></span><div><strong>${escapeHtml(r.restriction_type)}</strong><small>${escapeHtml(r.customer_number)} · ${escapeHtml(r.scope)}</small></div><span class="tag high">${escapeHtml(r.status)}</span></div>`).join("") : "No active restrictions.";
}

async function loadPlatforms() {
  const data = await api("/api/platforms");
  state.platforms = data.platforms;
  $("#platformRows").innerHTML = data.platforms.map(p => `<tr><td><strong>${escapeHtml(p.name)}</strong></td><td><code>${escapeHtml(p.code)}</code></td><td><span class="tag ${p.status === "active" ? "success" : "review"}">${escapeHtml(p.status)}</span></td><td>${Number(p.active_credential_count || 0)}</td><td>${formatDate(p.last_api_activity_at)}</td><td><button class="secondary-button generate-key" data-platform-id="${escapeHtml(p.id)}">Generate key</button></td></tr>`).join("");
  setEmpty("#platformEmpty", data.platforms.length === 0);
  $$(".generate-key").forEach(button => button.addEventListener("click", () => {
    const platform = state.platforms.find(p => p.id === button.dataset.platformId);
    $("#credentialForm [name='platformId']").value = platform.id;
    $("#credentialPlatformName").textContent = `${platform.name} · ${platform.code}`;
    $("#credentialDialog").showModal();
  }));
}

async function loadAdministration() {
  const data = await api("/api/administration");
  state.administration = data;
  $("#branchContext").innerHTML = data.units.map(unit => `<option value="${escapeHtml(unit.code)}">${escapeHtml(unit.name)}</option>`).join("");
  $("#staffRows").innerHTML = data.staff.map(s => `<tr><td><div class="customer-cell"><div class="mini-avatar">${escapeHtml(s.display_name.split(/\s+/).map(x => x[0]).slice(0,2).join(""))}</div><div><strong>${escapeHtml(s.display_name)}</strong><small>${escapeHtml(s.email)}</small></div></div></td><td>Microsoft Entra</td><td>${escapeHtml(s.role_codes || "Awaiting role assignment")}</td><td><span class="tag success">${escapeHtml(s.status)}</span></td><td>${formatDate(s.created_at)}</td></tr>`).join("");
  setEmpty("#staffEmpty", data.staff.length === 0);
  $("#roleCards").innerHTML = data.roles.map(role => `<article class="panel feature-card"><div class="feature-symbol">✓</div><h2>${escapeHtml(role.name)}</h2><p>${escapeHtml(role.description)}</p><span class="tag ${role.status === "active" ? "success" : "review"}">${escapeHtml(role.status)}</span></article>`).join("");
  $("#auditRows").innerHTML = data.audit.map(a => `<tr><td>${formatDate(a.occurred_at)}</td><td>${escapeHtml(a.actor_name || "System")}</td><td>${escapeHtml(a.action_label)}</td><td>${escapeHtml(a.entity_type)}</td><td>${escapeHtml(a.entity_reference || "—")}</td></tr>`).join("");
  setEmpty("#auditEmpty", data.audit.length === 0);
}

async function loadConfiguration() {
  const data = await api("/api/configuration");
  state.configuration = data;
  const form = $("#settingsForm");
  for (const setting of data.settings) {
    const input = form.elements.namedItem(setting.setting_key);
    if (!input) continue;
    const value = JSON.parse(setting.value_json);
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value;
  }
  $("#securityCatalogue").innerHTML = [...data.markerTypes.map(x => ({ label:x.label, detail:`Marker · ${x.default_risk_level} risk · review ${x.review_days || "manual"} days` })), ...data.restrictionTypes.map(x => ({ label:x.label, detail:`Restriction · ${x.enforcement_action.replaceAll("_"," ")}` }))].map(x => `<div class="catalogue-row"><div><strong>${escapeHtml(x.label)}</strong><small>${escapeHtml(x.detail)}</small></div><span class="tag success">Active</span></div>`).join("");
}

async function boot() {
  renderModules();
  try {
    const session = await api("/api/auth/session");
    const authError = new URLSearchParams(location.search).get("auth_error");
    if (authError) {
      history.replaceState({}, "", location.pathname);
      return showLogin(authError);
    }
    if (!session.configured) return showLogin("Microsoft staff sign-in has not been configured in Cloudflare yet.");
    $("#microsoftLogin").hidden = !session.microsoft?.configured;
    if (!session.authenticated) return showLogin();
    showApp(session.user);
    await Promise.all([loadDashboard(), loadCustomers(), loadCases(), loadSecurity(), loadPlatforms(), loadAdministration(), loadConfiguration()]);
    const requestedView = location.hash.replace("#/", "");
    if (requestedView && $(`#${CSS.escape(requestedView)}.view`)) showView(requestedView);
  } catch (error) {
    showLogin(error.message);
  }
}

$("#signOutButton").addEventListener("click", async () => {
  const result = await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => ({}));
  if (result.redirect) location.assign(result.redirect);
  else showLogin();
});
$("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$$(".nav-item").forEach(item => item.addEventListener("click", () => showView(item.dataset.view)));
$$("[data-action='new-customer']").forEach(b => b.addEventListener("click", () => $("#customerDialog").showModal()));
$$("[data-action='new-case']").forEach(b => b.addEventListener("click", () => $("#caseDialog").showModal()));
$$("[data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
$("#customerSearch").addEventListener("input", e => loadCustomers(e.target.value).catch(console.error));
$("#globalSearch").addEventListener("keydown", e => { if (e.key === "Enter") { showView("customers"); $("#customerSearch").value = e.target.value; loadCustomers(e.target.value); } });
document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#globalSearch").focus(); } });

$("#customerForm").addEventListener("submit", async event => {
  event.preventDefault(); const form = event.currentTarget; $(".form-error", form).textContent = "";
  try { await api("/api/customers", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); $("#customerDialog").close(); await Promise.all([loadDashboard(), loadCustomers()]); }
  catch (error) { $(".form-error", form).textContent = error.message; }
});
$("#caseForm").addEventListener("submit", async event => {
  event.preventDefault(); const form = event.currentTarget; $(".form-error", form).textContent = "";
  try { await api("/api/cases", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); $("#caseDialog").close(); await Promise.all([loadDashboard(), loadCases()]); }
  catch (error) { $(".form-error", form).textContent = error.message; }
});
$("#registerPlatformButton").addEventListener("click", () => $("#platformDialog").showModal());
$("#platformForm").addEventListener("submit", async event => {
  event.preventDefault(); const form = event.currentTarget; $(".form-error", form).textContent = "";
  try {
    await api("/api/platforms", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset(); $("#platformDialog").close(); await Promise.all([loadDashboard(), loadPlatforms()]);
  } catch (error) { $(".form-error", form).textContent = error.message; }
});
$("#credentialForm").addEventListener("submit", async event => {
  event.preventDefault(); const form = event.currentTarget; $(".form-error", form).textContent = "";
  const data = new FormData(form);
  try {
    const result = await api(`/api/platforms/${encodeURIComponent(data.get("platformId"))}/credentials`, { method: "POST", body: JSON.stringify({ name: data.get("name"), scopes: data.getAll("scopes") }) });
    form.reset(); $("#credentialDialog").close(); $("#generatedKey").textContent = result.credential.token; $("#keyDialog").showModal(); await Promise.all([loadDashboard(), loadPlatforms()]);
  } catch (error) { $(".form-error", form).textContent = error.message; }
});
$("#copyKeyButton").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#generatedKey").textContent);
  $("#copyKeyButton").textContent = "Copied";
});
$("#settingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#settingsStatus");
  status.textContent = "Saving configuration…";
  try {
    const requests = [...form.elements].filter(input => input.name).map(input => api("/api/configuration", {
      method: "PUT",
      body: JSON.stringify({ key: input.name, value: input.type === "checkbox" ? input.checked : (input.type === "number" ? Number(input.value) : input.value) })
    }));
    await Promise.all(requests);
    status.textContent = "Configuration saved and recorded in the audit history.";
    await Promise.all([loadConfiguration(), loadAdministration()]);
  } catch (error) { status.textContent = error.message; }
});
boot();
