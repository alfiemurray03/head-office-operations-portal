const customers = [
  { name: "Sarah Mitchell", initials: "SM", email: "sarah.mitchell@example.com", number: "5830192744", platforms: ["Planyx", "Profile Centre"], status: "Restricted", risk: "Critical", activity: "12 min ago" },
  { name: "Daniel Adams", initials: "DA", email: "daniel.adams@example.com", number: "7046183291", platforms: ["Planyx"], status: "Active", risk: "Clear", activity: "48 min ago" },
  { name: "Oliver Brooks", initials: "OB", email: "oliver.brooks@example.com", number: "2319704586", platforms: ["Profile Centre"], status: "Active", risk: "Review", activity: "2 hrs ago" },
  { name: "Amelia Hart", initials: "AH", email: "amelia.hart@example.com", number: "1984527630", platforms: ["Planyx"], status: "Active", risk: "Clear", activity: "3 hrs ago" },
  { name: "Noah Williams", initials: "NW", email: "noah.williams@example.com", number: "8261047395", platforms: ["Planyx", "Profile Centre"], status: "Active", risk: "Monitor", activity: "Yesterday" },
  { name: "Priya Shah", initials: "PS", email: "priya.shah@example.com", number: "4602381975", platforms: ["Profile Centre"], status: "Active", risk: "Clear", activity: "Yesterday" }
];

const previewAccount = Object.freeze({
  username: "admin",
  password: "PreviewOnly!2026"
});

const loginScreen = document.getElementById("loginScreen");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

function unlockPortal(remember = false) {
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem("ja-ho-preview-session", "active");
  loginScreen.classList.add("hidden");
  document.body.classList.remove("locked");
}

function signOut() {
  localStorage.removeItem("ja-ho-preview-session");
  sessionStorage.removeItem("ja-ho-preview-session");
  loginForm.reset();
  loginError.textContent = "";
  loginScreen.classList.remove("hidden");
  document.body.classList.add("locked");
  document.getElementById("username").focus();
}

if (localStorage.getItem("ja-ho-preview-session") === "active" || sessionStorage.getItem("ja-ho-preview-session") === "active") {
  unlockPortal(localStorage.getItem("ja-ho-preview-session") === "active");
} else {
  document.body.classList.add("locked");
  window.setTimeout(() => document.getElementById("username").focus(), 100);
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(loginForm);
  if (form.get("username") === previewAccount.username && form.get("password") === previewAccount.password) {
    loginError.textContent = "";
    unlockPortal(document.getElementById("rememberDevice").checked);
  } else {
    loginError.textContent = "The username or password is incorrect.";
    document.getElementById("password").value = "";
    document.getElementById("password").focus();
  }
});

document.getElementById("showPassword").addEventListener("click", () => {
  const password = document.getElementById("password");
  password.type = password.type === "password" ? "text" : "password";
});

document.getElementById("signOutButton").addEventListener("click", signOut);

const views = {
  cases: ["▣", "Cases", "Manage security investigations, account recovery, refunds, disputes and other formal Head Office matters."],
  security: ["◇", "Security Control Centre", "Review account risks, markers, restrictions and cross-platform enforcement instructions."],
  complaints: ["☷", "Complaints", "Record, investigate and respond to complaints across every connected JA Group Services platform."],
  payments: ["£", "Payments & refunds", "Review payments, subscription disputes, refund requests and approval decisions."],
  platforms: ["⌘", "Connected platforms", "Manage Planyx, Profile Centre and future service integrations from one central register."],
  staff: ["♙", "Staff & roles", "Control staff membership, role assignments, approval limits and access permissions."],
  audit: ["◷", "Audit history", "Inspect the permanent record of access, decisions and changes made through the portal."],
  settings: ["⚙", "System settings", "Configure portal behaviour, case references, connected services and governance controls."]
};

function showView(id) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === id));
  document.getElementById("sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCustomers(query = "") {
  const body = document.getElementById("customerRows");
  const filtered = customers.filter((customer) =>
    Object.values(customer).flat().join(" ").toLowerCase().includes(query.toLowerCase())
  );
  body.innerHTML = filtered.map((customer) => `
    <tr data-customer="${customer.number}">
      <td><div class="customer-cell"><div class="mini-avatar">${customer.initials}</div><div><strong>${customer.name}</strong><small>${customer.email}</small></div></div></td>
      <td><strong>${customer.number}</strong></td>
      <td><div class="platform-chips">${customer.platforms.map((platform) => `<span>${platform}</span>`).join("")}</div></td>
      <td><span class="status-dot ${customer.status === "Active" ? "active" : "restricted"}"></span>${customer.status}</td>
      <td><span class="tag ${customer.risk === "Critical" ? "critical" : customer.risk === "Clear" ? "success" : "review"}">${customer.risk}</span></td>
      <td>${customer.activity}</td><td>›</td>
    </tr>`).join("");
  body.querySelectorAll("tr").forEach((row) => row.addEventListener("click", () => openCustomer(row.dataset.customer)));
}

function openCustomer(number) {
  const customer = customers.find((item) => item.number === number);
  if (!customer) return;
  document.getElementById("detailName").textContent = customer.name;
  document.getElementById("detailEmail").textContent = customer.email;
  document.getElementById("identityEmail").firstChild.textContent = `${customer.email} `;
  document.getElementById("detailNumber").textContent = customer.number;
  document.getElementById("detailInitials").textContent = customer.initials;
  showView("customer-detail");
}

for (const [id, [icon, title, copy]] of Object.entries(views)) {
  document.getElementById(id).innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">Head Office Operations</p><h1>${title}</h1><p>${copy}</p></div></div>
    <div class="placeholder-card"><div>${icon}</div><h1>${title} workspace</h1><p>This module is included in the Version 1 structure. Its full workflow and live records will be activated in the next controlled build stage.</p><button class="primary-button" data-action="new-case">＋ Create case</button></div>`;
}

document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => showView(item.dataset.view)));
document.querySelectorAll("[data-view-target]").forEach((item) => item.addEventListener("click", () => showView(item.dataset.viewTarget)));
document.querySelectorAll("[data-action='new-case']").forEach((button) => button.addEventListener("click", () => document.getElementById("caseDialog").showModal()));
document.getElementById("menuButton").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
document.getElementById("customerSearch").addEventListener("input", (event) => renderCustomers(event.target.value));
document.querySelector(".notice button").addEventListener("click", (event) => event.currentTarget.closest(".notice").remove());
document.getElementById("globalSearch").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.value.trim()) {
    showView("customers");
    document.getElementById("customerSearch").value = event.target.value;
    renderCustomers(event.target.value);
  }
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.getElementById("globalSearch").focus();
  }
});
renderCustomers();
