function automationConfiguration(env) {
  const baseUrl = String(env.PORTAL_BASE_URL || "").replace(/\/+$/, "");
  const secret = String(env.AUTOMATION_SECRET || "").trim();
  if (!baseUrl || !secret) throw new Error("PORTAL_BASE_URL and AUTOMATION_SECRET must be configured.");
  return { baseUrl, secret };
}

async function runSchedulerCycle(env) {
  const { baseUrl, secret } = automationConfiguration(env);
  const response = await fetch(`${baseUrl}/api/automation/scheduler/tick`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
      "User-Agent": "JA-Head-Office-Automation-Scheduler/1.0"
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `Automation scheduler returned HTTP ${response.status}.`);
  console.log(JSON.stringify({ event: "automation_scheduler_cycle_completed", result }));
  return result;
}

export default {
  async scheduled(controller, env, context) {
    context.waitUntil(runSchedulerCycle(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        status: "operational",
        service: "Head Office Automation and Scheduling Centre",
        schedulerResolution: "one minute",
        executionAuthority: "governed schedules stored in Head Office D1",
        safety: {
          criticalLockdownAutomated: false,
          arbitraryScriptsAllowed: false,
          arbitraryExternalUrlsAllowed: false
        }
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/run" && request.method === "POST") {
      const supplied = request.headers.get("Authorization") || "";
      if (!env.AUTOMATION_SECRET || supplied !== `Bearer ${env.AUTOMATION_SECRET}`) {
        return Response.json({ error: "Unauthorised" }, { status: 401 });
      }
      try {
        return Response.json(await runSchedulerCycle(env));
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Automation scheduler failed" }, { status: 502 });
      }
    }
    return new Response("Not found", { status: 404 });
  }
};
