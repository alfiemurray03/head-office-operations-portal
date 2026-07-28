async function runCustomerDirectorySync(env) {
  const baseUrl = String(env.PORTAL_BASE_URL || "").replace(/\/+$/, "");
  const secret = String(env.AUTOMATION_SECRET || "").trim();
  if (!baseUrl || !secret) throw new Error("PORTAL_BASE_URL and AUTOMATION_SECRET must be configured.");

  const response = await fetch(`${baseUrl}/api/automation/customer-directory/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
      "User-Agent": "JA-Head-Office-Customer-Automation/1.0"
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error?.message || `Head Office reconciliation returned HTTP ${response.status}.`);
  }
  console.log(JSON.stringify({
    event: "customer_directory_sync_completed",
    completedAt: result.completedAt,
    runId: result.runId,
    stats: result.stats,
    totals: result.totals
  }));
  return result;
}

export default {
  async scheduled(controller, env, context) {
    context.waitUntil(runCustomerDirectorySync(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        status: "operational",
        service: "Head Office customer directory automation",
        schedule: "hourly"
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/run" && request.method === "POST") {
      const supplied = request.headers.get("Authorization") || "";
      if (!env.AUTOMATION_SECRET || supplied !== `Bearer ${env.AUTOMATION_SECRET}`) {
        return Response.json({ error: "Unauthorised" }, { status: 401 });
      }
      try {
        return Response.json(await runCustomerDirectorySync(env));
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Automation failed" }, { status: 502 });
      }
    }
    return new Response("Not found", { status: 404 });
  }
};
