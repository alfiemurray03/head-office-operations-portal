const OPS_ROUTE_LABELS = {
  "control-room": "Head Office Control Room",
  "risk-intelligence": "Fraud & Risk Intelligence",
  "incidents-v7": "Incident Command & Data Breaches",
  "central-operations": "Central Head Office Operations",
  dashboard: "Operations Overview",
  customers: "Universal Customer Register",
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

function updateOperationsRouteChrome(route = routeFromHash()) {
  const label = OPS_ROUTE_LABELS[route] || "Head Office";
  const target = document.querySelector("#currentRouteLabel");
  if (target) target.textContent = label;
  document.title = `${label} · Head Office Operations & Security Centre`;
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
