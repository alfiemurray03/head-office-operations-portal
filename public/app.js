const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { platforms: [] };

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
    communications: ["✉", "Customer communications", "Company-wide correspondence history, approved templates and communication preferences.", "Communication records will become available when a customer record or case contains correspondence."],
    payments: ["£", "Payments and refunds", "Central payment references, refund approvals and disputes. Stripe remains the payment processor.", "No payment provider is connected. No payment data is being represented."],
    complaints: ["☷", "Complaints", "Formal complaint intake, acknowledgement, investigation, response and outcome tracking.", "Complaint cases created in Case Management appear here."],
    "data-protection": ["◫", "Data protection", "Controlled handling of rights requests, incidents, objections, erasure and disclosure decisions.", "Access will be restricted to authorised data protection roles."],
    safeguarding: ["◈", "Safeguarding", "Restricted safeguarding concern records with enhanced access controls and disclosure logging.", "Access will be restricted to designated safeguarding roles."],
    staff: ["♙", "Staff and access", "Local staff accounts, roles, permissions, approval limits and access reviews.", "Microsoft Entra staff identity will replace local credentials in the next identity phase."],
    audit: ["◷", "Audit history", "Append-only record of access, decisions, changes and integration actions.", "Audit entries appear automatically when controlled actions occur."],
    settings: ["⚙", "System settings", "Reference rules, risk catalogue, retention controls and company-wide configuration.", "Settings are governed configuration, not browser-only preferences."]
  };
  for (const [id, [icon, title, copy, empty]] of Object.entries(modules)) {
    $(`#${id}`).innerHTML = `<div class="page-heading"><div><p class="eyebrow">Head Office Operations</p><h1>${title}</h1><p>${copy}</p></div></div><article class="panel governed-module"><div class="module-icon">${icon}</div><div><h2>${title}</h2><p>${empty}</p></div><span class="tag review">Foundation configured</span></article>`;
  }
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

async function boot() {
  renderModules();
  try {
    const session = await api("/api/auth/session");
    if (!session.configured) return showLogin("Local sign-in has not been configured in Cloudflare yet.");
    if (!session.authenticated) return showLogin();
    showApp(session.user);
    await Promise.all([loadDashboard(), loadCustomers(), loadCases(), loadSecurity(), loadPlatforms()]);
  } catch (error) {
    showLogin(error.message);
  }
}

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("#loginError").textContent = "";
  try {
    const form = new FormData(event.currentTarget);
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
    showApp(result.user);
    await Promise.all([loadDashboard(), loadCustomers(), loadCases(), loadSecurity(), loadPlatforms()]);
  } catch (error) { $("#loginError").textContent = error.message; }
});
$("#showPassword").addEventListener("click", () => { $("#password").type = $("#password").type === "password" ? "text" : "password"; });
$("#signOutButton").addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {}); showLogin(); });
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
boot();
