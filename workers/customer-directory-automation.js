function automationConfiguration(env) {
  const baseUrl = String(env.PORTAL_BASE_URL || "").replace(/\/+$/, "");
  const secret = String(env.AUTOMATION_SECRET || "").trim();
  if (!baseUrl || !secret) throw new Error("PORTAL_BASE_URL and AUTOMATION_SECRET must be configured.");
  return { baseUrl, secret };
}

async function runPortalJob(env, path, eventName) {
  const { baseUrl, secret } = automationConfiguration(env);
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
      "User-Agent": "JA-Head-Office-Automation/3.0"
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `${eventName} returned HTTP ${response.status}.`);
  console.log(JSON.stringify({ event: eventName, completedAt: result.completedAt, result }));
  return result;
}

async function runHeadOfficeAutomation(env) {
  const customerDirectory = await runPortalJob(env, "/api/automation/customer-directory/sync", "customer_directory_sync_completed");
  const staffDirectory = await runPortalJob(env, "/api/automation/staff-directory/sync", "staff_directory_sync_completed");
  const stripe = await runPortalJob(env, "/api/automation/stripe/sync", "stripe_reconciliation_completed");
  return { completedAt: new Date().toISOString(), customerDirectory, staffDirectory, stripe };
}

export default {
  async scheduled(controller, env, context) {
    context.waitUntil(runHeadOfficeAutomation(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        status: "operational",
        service: "Head Office directory and Stripe reconciliation automation",
        schedule: "hourly",
        jobs: [
          "JA Group Services ID customer directory",
          "JA Group Services Microsoft staff tenant",
          "Planyx Stripe",
          "Profile Centre Stripe"
        ]
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/run" && request.method === "POST") {
      const supplied = request.headers.get("Authorization") || "";
      if (!env.AUTOMATION_SECRET || supplied !== `Bearer ${env.AUTOMATION_SECRET}`) {
        return Response.json({ error: "Unauthorised" }, { status: 401 });
      }
      try {
        return Response.json(await runHeadOfficeAutomation(env));
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Automation failed" }, { status: 502 });
      }
    }
    return new Response("Not found", { status: 404 });
  }
};
