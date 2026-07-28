const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  sessionToken: "",
  session: null,
  reference: { permissions: [], roles: [], platforms: [], staff: [], units: [], roleDefinitions: [], markerTypes: [], restrictionTypes: [], settings: {} },
  route: "dashboard",
  routeQuery: {},
  customerFilters: { q: "", accountStatus: "", securityStatus: "" },
  caseFilters: { q: "", type: "", status: "", priority: "" },
  securityQuery: "",
  communicationFilters: { q: "", channel: "", direction: "" },
  paymentFilters: { q: "", status: "" },
  auditFilters: { q: "", entityType: "", actorType: "" }
};

function storedSession() {
  if (state.sessionToken) return state.sessionToken;
  try { state.sessionToken = sessionStorage.getItem("customerops_staff_session") || ""; } catch {}
  return state.sessionToken;
}

function retainSession(token) {
  state.sessionToken = String(token || "").trim();
  if (!state.sessionToken) return;
  try { sessionStorage.setItem("customerops_staff_session", state.sessionToken); } catch {}
}

function clearSession() {
  state.sessionToken = "";
  try { sessionStorage.removeItem("customerops_staff_session"); } catch {}
}

async function api(path, options = {}) {
  const token = storedSession();
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) showLogin("Your staff session has ended. Sign in again.");
    const problem = new Error(data.error?.message || "The request could not be completed.");
    problem.code = data.error?.code;
    problem.status = response.status;
    throw problem;
  }
  return data;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function formatDate(value, fallback = "—") {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function formatDateInput(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatMoney(amountMinor, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(Number(amountMinor || 0) / 100);
}

function label(value = "") {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function initials(name = "") {
  return String(name).split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "--";
}

function hasPermission(required) {
  const permissions = state.reference.permissions || [];
  if (permissions.includes("*") || permissions.includes(required)) return true;
  const [area] = required.split(":");
  return permissions.includes(`${area}:*`);
}

function tag(value, extra = "") {
  return `<span class="tag ${escapeHtml(String(value || "").toLowerCase())} ${extra}">${escapeHtml(label(value || "unknown"))}</span>`;
}

function emptyState(title, copy) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`;
}

function toast(title, message = "", type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ""}`;
  $("#toastRegion").append(item);
  setTimeout(() => item.remove(), 4500);
}

function showLogin(note = "") {
  document.body.classList.add("locked");
  $("#appShell").hidden = true;
  $("#loginScreen").hidden = false;
  $("#configurationNote").textContent = note;
}

function showApp() {
  document.body.classList.remove("locked");
  $("#loginScreen").hidden = true;
  $("#appShell").hidden = false;
  const user = state.session.user;
  $("#userName").textContent = user.displayName;
  $("#userRole").textContent = user.roleName || "Authorised staff";
  $("#userInitials").textContent = initials(user.displayName);
}

function openModal(title, description, content, eyebrow = "Head Office record") {
  $("#modalEyebrow").textContent = eyebrow;
  $("#modalTitle").textContent = title;
  $("#modalDescription").textContent = description || "";
  $("#modalContent").innerHTML = content;
  if (!$("#modal").open) $("#modal").showModal();
}

function closeModal() {
  if ($("#modal").open) $("#modal").close();
}

function setLoading(message = "Loading Head Office records…") {
  $("#viewRoot").innerHTML = `<div class="loading-state"><span class="spinner"></span><p>${escapeHtml(message)}</p></div>`;
}

function options(rows, valueKey, labelKey, selected = "", blank = "Select…") {
  return `<option value="">${escapeHtml(blank)}</option>${rows.map(row => `<option value="${escapeHtml(row[valueKey])}" ${String(row[valueKey]) === String(selected) ? "selected" : ""}>${escapeHtml(row[labelKey])}</option>`).join("")}`;
}

function renderNavigation() {
  $$('[data-permission]').forEach(item => { item.hidden = !hasPermission(item.dataset.permission); });
  $("#operatingContext").innerHTML = state.reference.units.filter(unit => unit.status === "active").map(unit => `<option value="${escapeHtml(unit.code)}">${escapeHtml(unit.name)}</option>`).join("") || '<option value="HEAD_OFFICE">Head Office</option>';
}

function routeFromHash() {
  const raw = location.hash.startsWith("#/") ? location.hash.slice(2) : "dashboard";
  return raw.split("?")[0] || "dashboard";
}

function navigate(route, replace = false) {
  const destination = `#/${route}`;
  if (replace) { history.replaceState({}, "", destination); return renderRoute(route); }
  if (location.hash !== destination) location.hash = destination;
  else return renderRoute(route);
}

async function renderRoute(route = routeFromHash()) {
  state.route = route;
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.route === route));
  $("#sidebar").classList.remove("open");
  setLoading();
  try {
    if (route === "dashboard") return await renderDashboard();
    if (route === "customers") return await renderCustomers();
    if (["cases", "complaints", "data-protection", "safeguarding"].includes(route)) return await renderCases(route);
    if (route === "security") return await renderSecurity();
    if (route === "communications") return await renderCommunications();
    if (route === "payments") return await renderPayments();
    if (route === "platforms") return await renderPlatforms();
    if (route === "staff") return await renderStaff();
    if (route === "audit") return await renderAudit();
    if (route === "settings") return await renderSettings();
    return navigate("dashboard", true);
  } catch (error) {
    $("#viewRoot").innerHTML = `<div class="panel"><div class="empty-state"><strong>The section could not be opened</strong><span>${escapeHtml(error.message)}</span></div></div>`;
    toast("Section unavailable", error.message, "error");
  }
}
