const OPS_ROUTE_LABELS = {
  "control-room": "Control Room",
  "risk-intelligence": "Risk Intelligence",
  "incidents-v7": "Incidents & Data Breaches",
  "central-operations": "Central Operations",
  dashboard: "Operations Overview",
  customers: "Universal Customers",
  cases: "Case Management",
  communications: "Communications",
  payments: "Payments & Approvals",
  security: "Security Control Centre",
  complaints: "Complaints",
  "data-protection": "Data Protection",
  safeguarding: "Safeguarding",
  "security-levels": "Security Levels",
  platforms: "Connected Systems",
  staff: "Staff & Access",
  audit: "Audit History",
  settings: "System Settings"
};

function updateOperationsRouteChrome(route = routeFromHash()) {
  const label = OPS_ROUTE_LABELS[route] || "Head Office";
  const target = document.querySelector("#currentRouteLabel");
  if (target) target.textContent = label;
  document.title = `${label} · Head Office Customer Operations Centre`;
}

function closeOperationsTools() {
  const drawer = document.querySelector("#sidebar");
  if (drawer) drawer.classList.remove("open");
}

function applyOperationsTheme(theme) {
  const resolved = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.opsTheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#0f172a" : "#ffffff");
  try { localStorage.setItem("head_office_theme", resolved); } catch {}
}

(function initialiseOperationsShell() {
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
    return originalRenderRoute(route);
  };

  window.addEventListener("hashchange", () => updateOperationsRouteChrome(routeFromHash()));
  updateOperationsRouteChrome();
})();
