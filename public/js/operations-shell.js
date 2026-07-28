const OPS_ROUTE_LABELS = {
  "control-room": "Head Office Control Room",
  "risk-intelligence": "Fraud & Risk Intelligence",
  "customer-protection": "Customer Protection Operations",
  "incidents-v7": "Incident Command & Data Breaches",
  "central-operations": "Central Head Office Operations",
  dashboard: "Operations Overview",
  customers: "Universal Customer Register",
  "customer-directory": "Microsoft Customer Directory",
  cases: "Case & Investigation Register",
  communications: "Communications Record",
  payments: "Payments, Refunds & Approvals",
  security: "Security Markers & Restrictions",
  complaints: "Complaint & Redress Register",
  "data-protection": "Data Protection Cases",
  safeguarding: "Safeguarding Cases",
  "security-levels": "Security Control Taxonomy",
  platforms: "Connected Systems",
  staff: "Staff Identity & Authority",
  audit: "Audit & Evidence History",
  settings: "Governed Configuration"
};

const HEAD_OFFICE_WORKSPACES = {
  command: {
    label: "Executive Control",
    shortLabel: "Control",
    code: "CTRL",
    route: "control-room",
    permission: "risk:read",
    description: "Live oversight of operational demand, security posture, incidents and decisions requiring Head Office authority.",
    routes: [
      ["control-room", "Control room", "risk:read"],
      ["dashboard", "Operations overview", ""]
    ]
  },
  customer: {
    label: "Customer Operations Centre",
    shortLabel: "Customer operations",
    code: "COC",
    route: "central-operations",
    permission: "operations:read",
    description: "Company-wide customer identity, casework, communications and service activity in one operational workspace.",
    routes: [
      ["central-operations", "Operations queue", "operations:read"],
      ["customers", "Customer register", "customers:read"],
      ["customer-directory", "External ID directory", "platforms:read"],
      ["cases", "Cases & investigations", "cases:read"],
      ["communications", "Communications", "communications:read"]
    ]
  },
  security: {
    label: "Security Operations Centre",
    shortLabel: "Security operations",
    code: "SOC",
    route: "customer-protection",
    permission: "risk:read",
    description: "Prevention, identity and device trust, payment protection, fraud intelligence and governed intervention.",
    routes: [
      ["customer-protection", "Customer protection", "risk:read"],
      ["risk-intelligence", "Risk intelligence", "risk:read"],
      ["security", "Markers & restrictions", "security:read"],
      ["security-levels", "Control taxonomy", "risk:read"],
      ["data-protection", "Data protection", "data_protection:*"],
      ["safeguarding", "Safeguarding", "safeguarding:*"]
    ]
  },
  incident: {
    label: "Incident & Breach Command",
    shortLabel: "Incident command",
    code: "IC",
    route: "incidents-v7",
    permission: "incidents:read",
    description: "Triage, containment, breach assessment, recovery and evidence for operational and security incidents.",
    routes: [
      ["incidents-v7", "Incident command", "incidents:read"],
      ["audit", "Incident evidence", "audit:read"],
      ["data-protection", "Breach assessment", "data_protection:*"]
    ]
  },
  redress: {
    label: "Complaints, Refunds & Disputes",
    shortLabel: "Redress & disputes",
    code: "CRD",
    route: "complaints",
    permission: "complaints:read",
    description: "Formal complaint handling, payment disputes, refunds, approvals and customer redress decisions.",
    routes: [
      ["complaints", "Complaints & redress", "complaints:read"],
      ["payments", "Refunds & disputes", "payments:read"],
      ["cases", "Linked casework", "cases:read"],
      ["communications", "Customer contact", "communications:read"]
    ]
  },
  assurance: {
    label: "Assurance & Administration",
    shortLabel: "Assurance & admin",
    code: "A&A",
    route: "audit",
    permission: "audit:read",
    description: "Connected systems, staff authority, audit evidence and controlled production configuration.",
    routes: [
      ["platforms", "Connected systems", "platforms:read"],
      ["staff", "Staff authority", "administration:read"],
      ["audit", "Audit & evidence", "audit:read"],
      ["settings", "Configuration", "configuration:read"]
    ]
  }
};

const ROUTE_WORKSPACE = {
  "control-room": "command",
  dashboard: "command",
  "central-operations": "customer",
  customers: "customer",
  "customer-directory": "customer",
  cases: "customer",
  communications: "customer",
  "customer-protection": "security",
  "risk-intelligence": "security",
  security: "security",
  "security-levels": "security",
  "data-protection": "security",
  safeguarding: "security",
  "incidents-v7": "incident",
  complaints: "redress",
  payments: "redress",
  platforms: "assurance",
  staff: "assurance",
  audit: "assurance",
  settings: "assurance"
};

let customerProtectionModulePromise = null;

function ensureWorkspaceStyles() {
  if (document.querySelector('link[data-workspace-shell]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/workspace-shell.css?v=20260728-workspace-1";
  link.dataset.workspaceShell = "true";
  document.head.append(link);
}

function ensureCustomerProtectionModule() {
  if (window.renderCustomerProtectionWorkspace) return Promise.resolve();
  if (customerProtectionModulePromise) return customerProtectionModulePromise;
  customerProtectionModulePromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-customer-protection]')) {
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = "/customer-protection.css?v=20260728-protection-1";
      style.dataset.customerProtection = "true";
      document.head.append(style);
    }
    const existing = document.querySelector('script[data-customer-protection]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("The Customer Protection workspace could not be loaded.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "/js/customer-protection.js?v=20260728-protection-1";
    script.async = false;
    script.dataset.customerProtection = "true";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error("The Customer Protection workspace could not be loaded.")), { once: true });
    document.head.append(script);
  });
  return customerProtectionModulePromise;
}

function workspaceForRoute(route) {
  return ROUTE_WORKSPACE[route] || "command";
}

function workspaceButton(key, workspace) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-item workspace-tab";
  button.dataset.route = workspace.route;
  button.dataset.workspaceTarget = key;
  if (workspace.permission) button.dataset.permission = workspace.permission;
  button.innerHTML = `<span class="workspace-tab-code">${workspace.code}</span><span class="workspace-tab-copy"><strong>${workspace.shortLabel}</strong><small>${workspace.label}</small></span>`;
  return button;
}

function ensureWorkspaceDrawerEntries() {
  if (document.querySelector('[data-route="customer-protection"]')) return;
  const securityEntry = document.querySelector('[data-route="security"]');
  const riskEntry = document.querySelector('[data-route="risk-intelligence"]');
  const target = riskEntry || securityEntry;
  if (!target?.parentElement) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nav-item";
  button.dataset.route = "customer-protection";
  button.dataset.permission = "risk:read";
  button.textContent = "Customer protection operations";
  target.parentElement.insertBefore(button, target);
}

function ensureWorkspaceChrome() {
  const header = document.querySelector(".ops-header");
  const subheader = document.querySelector(".ops-subheader");
  if (!header || !subheader || document.querySelector("#workspaceSwitcher")) return;

  const switcher = document.createElement("nav");
  switcher.id = "workspaceSwitcher";
  switcher.className = "workspace-switcher";
  switcher.setAttribute("aria-label", "Head Office workspaces");
  for (const [key, workspace] of Object.entries(HEAD_OFFICE_WORKSPACES)) {
    switcher.append(workspaceButton(key, workspace));
  }
  header.insertBefore(switcher, subheader);

  const context = document.createElement("section");
  context.id = "workspaceContext";
  context.className = "workspace-contextbar";
  context.innerHTML = `
    <div class="workspace-context-copy">
      <span class="workspace-context-kicker">JA Group Services Ltd · Head Office</span>
      <div><strong id="workspaceTitle">Executive Control</strong><small id="workspaceDescription"></small></div>
    </div>
    <nav id="workspaceNavigation" class="workspace-context-navigation" aria-label="Current workspace tools"></nav>`;
  header.append(context);

  ensureWorkspaceDrawerEntries();
  const drawerHeading = document.querySelector(".tools-drawer-heading strong");
  const drawerDescription = document.querySelector(".tools-drawer-heading span");
  if (drawerHeading) drawerHeading.textContent = "All Head Office functions";
  if (drawerDescription) drawerDescription.textContent = "Complete authorised function index";
}

function renderWorkspaceNavigation(key) {
  const workspace = HEAD_OFFICE_WORKSPACES[key] || HEAD_OFFICE_WORKSPACES.command;
  const navigation = document.querySelector("#workspaceNavigation");
  if (!navigation) return;
  navigation.innerHTML = "";
  for (const [route, label, permission] of workspace.routes) {
    if (permission && typeof hasPermission === "function") {
      try { if (!hasPermission(permission)) continue; } catch {}
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-item workspace-context-link";
    button.dataset.route = route;
    if (permission) button.dataset.permission = permission;
    button.textContent = label;
    navigation.append(button);
  }
}

function updateWorkspaceChrome(route = routeFromHash()) {
  const workspaceKey = workspaceForRoute(route);
  const workspace = HEAD_OFFICE_WORKSPACES[workspaceKey];
  document.body.dataset.workspace = workspaceKey;

  const title = document.querySelector("#workspaceTitle");
  const description = document.querySelector("#workspaceDescription");
  if (title) title.textContent = workspace.label;
  if (description) description.textContent = workspace.description;

  renderWorkspaceNavigation(workspaceKey);

  document.querySelectorAll("[data-workspace-target]").forEach(button => {
    button.classList.toggle("active", button.dataset.workspaceTarget === workspaceKey);
    if (button.dataset.workspaceTarget === workspaceKey) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll("#workspaceNavigation [data-route]").forEach(button => {
    button.classList.toggle("active", button.dataset.route === route);
  });

  const view = document.querySelector("#viewRoot");
  if (view) {
    view.dataset.workspace = workspaceKey;
    view.classList.add("workspace-view");
  }
}

function updateOperationsRouteChrome(route = routeFromHash()) {
  const label = OPS_ROUTE_LABELS[route] || "Head Office";
  const target = document.querySelector("#currentRouteLabel");
  if (target) target.textContent = label;
  document.title = `${label} · Head Office Operations & Security Centre`;
  updateWorkspaceChrome(route);
}

function closeOperationsTools() {
  const drawer = document.querySelector("#sidebar");
  if (drawer) drawer.classList.remove("open");
}

function applyOperationsTheme(theme) {
  const resolved = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.opsTheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#07111f" : "#101c2f");
  try { localStorage.setItem("head_office_theme", resolved); } catch {}
}

(function initialiseOperationsShell() {
  ensureWorkspaceStyles();
  ensureWorkspaceChrome();

  let savedTheme = "light";
  try {
    savedTheme = localStorage.getItem("head_office_theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch {
    savedTheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  applyOperationsTheme(savedTheme);

  document.querySelector("#themeToggle")?.addEventListener("click", () => {
    applyOperationsTheme(document.documentElement.dataset.opsTheme === "dark" ? "light" : "dark");
  });

  document.querySelector("#drawerCloseButton")?.addEventListener("click", closeOperationsTools);
  document.querySelector("#menuBackdrop")?.addEventListener("click", closeOperationsTools);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeOperationsTools();
  });

  const drawer = document.querySelector("#sidebar");
  const menuButton = document.querySelector("#menuButton");
  if (drawer && menuButton) {
    new MutationObserver(() => {
      menuButton.setAttribute("aria-expanded", drawer.classList.contains("open") ? "true" : "false");
    }).observe(drawer, { attributes: true, attributeFilter: ["class"] });
  }

  const originalRenderRoute = renderRoute;
  renderRoute = async function renderOperationsRoute(route = routeFromHash()) {
    updateOperationsRouteChrome(route);
    if (route === "customer-protection") {
      state.route = route;
      document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.route === route));
      closeOperationsTools();
      setLoading("Opening Customer Protection Operations…");
      try {
        await ensureCustomerProtectionModule();
        await window.renderCustomerProtectionWorkspace();
        updateWorkspaceChrome(route);
      } catch (error) {
        document.querySelector("#viewRoot").innerHTML = `<div class="panel"><div class="empty-state"><strong>Customer Protection could not be opened</strong><span>${escapeHtml(error.message || "The workspace is temporarily unavailable.")}</span></div></div>`;
        toast("Customer Protection unavailable", error.message || "The workspace could not be opened.", "error");
      }
      return;
    }
    const result = await originalRenderRoute(route);
    updateWorkspaceChrome(route);
    return result;
  };

  window.addEventListener("hashchange", () => updateOperationsRouteChrome(routeFromHash()));
  updateOperationsRouteChrome();
})();
