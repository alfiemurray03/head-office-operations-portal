async function boot() {
  const fragment = new URLSearchParams(location.hash.startsWith("#auth_session=") ? location.hash.slice(1) : "");
  const query = new URLSearchParams(location.search);
  const handoff = fragment.get("auth_session") || query.get("auth_session");
  if (handoff) retainSession(handoff);
  const authResult = query.get("auth_result");
  query.delete("auth_result");
  query.delete("auth_session");
  if (handoff || authResult) history.replaceState({}, "", `${location.pathname}${query.toString() ? `?${query}` : ""}#/control-room`);
  try {
    state.session = await api("/api/auth/session");
    if (!state.session.configured) return showLogin("Microsoft staff sign-in has not been configured in Cloudflare.");
    $("#microsoftLogin").hidden = !state.session.microsoft?.configured;
    if (!state.session.authenticated) return showLogin(authResult === "success" ? `Microsoft approved the sign-in, but the Centre could not open the staff session (${state.session.sessionStatus || "unknown"}).` : "");
    state.reference = await api("/api/reference");
    showApp();
    renderNavigation();
    const initialRoute = location.hash.startsWith("#/") ? routeFromHash() : (hasPermission("risk:read") ? "control-room" : "dashboard");
    navigate(initialRoute, true);
  } catch (error) {
    showLogin(error.message);
  }
}

$("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#signOutButton").addEventListener("click", async () => {
  const result = await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => ({}));
  clearSession();
  if (result.redirect) location.assign(result.redirect); else location.reload();
});
$("#globalSearch").addEventListener("keydown", event => {
  if (event.key === "Enter") { state.customerFilters.q = event.currentTarget.value.trim(); navigate("customers"); }
});
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#globalSearch").focus(); }
  if (event.key === "Escape" && $("#modal").open) closeModal();
});
document.addEventListener("click", event => handleClick(event.target).catch(error => toast("Action could not be completed", error.message, "error")));
document.addEventListener("submit", event => { event.preventDefault(); handleForm(event.target); });
window.addEventListener("hashchange", () => renderRoute(routeFromHash()));
setInterval(() => { $("#systemClock").textContent = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium" }).format(new Date()); }, 1000);
boot();
