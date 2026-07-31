(function principalAccountCentre() {
  const widgets = [
    ["security_overview", "Security overview"], ["platform_health", "Platform health"],
    ["active_incidents", "Active incidents"], ["pending_approvals", "Pending approvals"],
    ["recent_audit", "Recent audit activity"], ["customer_operations", "Customer operations"]
  ];

  function heading(title, copy) {
    return `<div class="page-heading"><div><p class="eyebrow">Your individual principal account</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(copy)}</p></div></div>`;
  }

  async function profileView() {
    const { profile } = await api("/api/account/profile");
    const titles = (profile.jobTitles || []).join("\n");
    $("#viewRoot").innerHTML = `${heading("Profile settings", "These details and settings belong only to your individually authenticated account.")}
      <div class="principal-grid"><form class="principal-card" id="principalProfileForm"><h2>Personal profile</h2><div class="principal-fields">
      <label>Full display name<input name="displayName" value="${escapeHtml(profile.fullName)}" required maxlength="200"></label>
      <label>Preferred name<input name="preferredName" value="${escapeHtml(profile.preferredName)}" required maxlength="100"></label>
      <label>Email address<input value="${escapeHtml(profile.email || "Managed by Microsoft Entra")}" disabled></label>
      <label>Profile image reference<input name="profileImage" value="${escapeHtml(profile.profileImage || "")}" maxlength="500"></label>
      <label style="grid-column:1/-1">Job titles, one per line<textarea name="jobTitles" rows="6">${escapeHtml(titles)}</textarea></label></div>
      <button class="button primary" type="submit">Save my profile</button></form>
      <aside class="principal-card"><h2>Authority</h2><div class="principal-badges"><span class="tag active">${escapeHtml(profile.roleName)}</span><span class="tag active">${escapeHtml(profile.securityLevel)}</span><span class="tag active">${escapeHtml(profile.accessLevel)}</span></div><p><strong>${escapeHtml(profile.authority)}</strong></p><p>Internal identity: ${escapeHtml(profile.id)}</p><p>Personalisation cannot change this authority.</p></aside></div>`;
    $("#principalProfileForm").addEventListener("submit", async event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      await api("/api/account/profile", { method: "PUT", body: JSON.stringify({ displayName: data.get("displayName"), preferredName: data.get("preferredName"), profileImage: data.get("profileImage"), jobTitles: String(data.get("jobTitles") || "").split("\n") }) });
      toast("Profile saved", "Your individual profile was updated."); await boot();
    });
  }

  async function securityView() {
    const data = await api("/api/account/security");
    const rows = data.sessions.map(item => `<div class="principal-session"><div><strong>${escapeHtml(item.device_label || "Browser session")}${item.id === data.currentSessionId ? " · Current" : ""}</strong><small>${escapeHtml(item.authentication_method)} · ${escapeHtml(item.authentication_strength || "Microsoft authentication")} · Last active ${formatDate(item.last_seen_at)}</small><small>Status: ${escapeHtml(item.status)} · Expires ${formatDate(item.expires_at)}</small></div>${item.status === "active" ? `<span><button class="button secondary small" data-revoke-session="${escapeHtml(item.id)}">Revoke</button> <button class="button secondary small" data-report-session="${escapeHtml(item.id)}">Report</button></span>` : ""}</div>`).join("");
    const events = data.authenticationEvents.map(item => `<tr><td>${formatDate(item.occurred_at)}</td><td>${tag(item.event_type)}</td><td>${escapeHtml(item.authentication_strength || item.reason_code || "Microsoft Entra")}</td></tr>`).join("");
    $("#viewRoot").innerHTML = `${heading("Security settings", "Review Microsoft authentication activity and control only your own portal sessions.")}<div class="principal-grid"><section class="principal-card"><h2>Active and recent sessions</h2>${rows || emptyState("No sessions", "No session records were found.")}<button class="button secondary" id="revokeAllSessions">Revoke all my sessions</button></section><section class="principal-card"><h2>Security posture</h2><p>Authentication: Microsoft Entra ID</p><p>Role: Head Office Principal</p><p>Access: Full · Highest</p><p>Session tokens are never shown in this interface.</p></section></div><section class="principal-card"><h2>Recent sign-in activity</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Result</th><th>Method or reason</th></tr></thead><tbody>${events}</tbody></table></div></section>`;
    $("#viewRoot").querySelectorAll("[data-revoke-session]").forEach(button => button.addEventListener("click", () => revoke(button.dataset.revokeSession, false)));
    $("#viewRoot").querySelectorAll("[data-report-session]").forEach(button => button.addEventListener("click", () => revoke(button.dataset.reportSession, false, true)));
    $("#revokeAllSessions").addEventListener("click", () => revoke(null, true));
  }

  async function revoke(sessionId, all, report = false) {
    const result = await api("/api/account/sessions/revoke", { method: "POST", body: JSON.stringify({ sessionId, all, report }) });
    if (result.currentSessionRevoked) { clearSession(); location.reload(); } else { toast("Session revoked"); await securityView(); }
  }

  async function preferencesView() {
    const { preferences } = await api("/api/account/preferences");
    const visible = new Set(preferences.dashboard?.widgets || []); const hidden = new Set(preferences.dashboard?.hidden || []);
    $("#viewRoot").innerHTML = `${heading("Personalisation", "Appearance and convenience settings apply only to your account and never reduce your authority.")}<form class="principal-card" id="preferencesForm"><div class="principal-fields"><label>Theme<select name="theme"><option ${preferences.theme === "system" ? "selected" : ""}>system</option><option ${preferences.theme === "light" ? "selected" : ""}>light</option><option ${preferences.theme === "dark" ? "selected" : ""}>dark</option></select></label><label>Table density<select name="tableDensity"><option ${preferences.tableDensity === "comfortable" ? "selected" : ""}>comfortable</option><option ${preferences.tableDensity === "compact" ? "selected" : ""}>compact</option><option ${preferences.tableDensity === "spacious" ? "selected" : ""}>spacious</option></select></label><label>Default section<input name="defaultLandingPage" value="${escapeHtml(preferences.defaultLandingPage)}"></label><label><input type="checkbox" name="sensitiveValuesMasked" ${preferences.sensitiveValuesMasked ? "checked" : ""}> Mask sensitive values by default</label></div><h2>Dashboard widgets</h2><div class="widget-list">${widgets.map(([id, name]) => `<label class="widget-row"><input type="checkbox" name="widget" value="${id}" ${visible.has(id) && !hidden.has(id) ? "checked" : ""}>${escapeHtml(name)}</label>`).join("")}</div><button class="button primary" type="submit">Save personalisation</button> <button class="button secondary" type="button" id="resetDashboard">Reset standard layout</button></form>`;
    const save = async reset => { const form = $("#preferencesForm"); const data = new FormData(form); const selected = reset ? widgets.slice(0,4).map(item => item[0]) : data.getAll("widget"); await api("/api/account/preferences", { method: "PUT", body: JSON.stringify({ theme: data.get("theme"), tableDensity: data.get("tableDensity"), defaultLandingPage: data.get("defaultLandingPage"), sensitiveValuesMasked: data.has("sensitiveValuesMasked"), dashboard: { widgets: selected, hidden: [], pinnedPlatforms: preferences.dashboard?.pinnedPlatforms || [], pinnedIncidents: preferences.dashboard?.pinnedIncidents || [], defaultPlatformView: preferences.dashboard?.defaultPlatformView || "all" } }) }); toast("Personalisation saved"); await preferencesView(); };
    $("#preferencesForm").addEventListener("submit", event => { event.preventDefault(); save(false); });
    $("#resetDashboard").addEventListener("click", () => save(true));
  }

  window.renderPrincipalAccount = route => route === "my-security" ? securityView() : route === "personalisation" ? preferencesView() : profileView();
})();
