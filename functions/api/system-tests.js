import { audit, cleanText, error, json, readJson } from "../_shared.js";
import { requirePermission } from "../_operations.js";
import { runAllSafeSystemTests, runSystemServiceTest, systemTestCentreSnapshot } from "../_system-tests.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "configuration:read");
  if (auth.response) return auth.response;
  try {
    return json(await systemTestCentreSnapshot(context.env), 200, { "Cache-Control": "no-store" });
  } catch (cause) {
    return error(cause.code || "SYSTEM_TEST_CENTRE_LOAD_FAILED", cause.message || "The System Test Centre could not be loaded.", cause.status || 500);
  }
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "configuration:write");
  if (auth.response) return auth.response;
  let body = {};
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  const serviceCode = cleanText(body.serviceCode || body.service || "all", 100).toLowerCase();
  const mode = body.mode === "controlled" ? "controlled" : "safe";
  const actor = { ...auth.session, email: cleanText(auth.session.email || auth.session.username, 254).toLowerCase() };
  try {
    const results = serviceCode === "all"
      ? await runAllSafeSystemTests(context.env, actor, context.data.requestId)
      : [await runSystemServiceTest(context.env, serviceCode, actor, context.data.requestId, { mode, confirmation: body.confirmation })];
    const counts = results.reduce((total, item) => {
      total[item.status] = Number(total[item.status] || 0) + 1;
      return total;
    }, {});
    await audit(context.env, auth.session, "system.tests_run", "system_test", serviceCode, {
      label: serviceCode === "all" ? "All safe service tests completed" : `${results[0].service.label} test completed`,
      reference: serviceCode,
      requestId: context.data.requestId,
      after: { mode: serviceCode === "all" ? "safe" : mode, counts, results: results.map(item => ({ serviceCode: item.service.code, status: item.status, durationMs: item.durationMs })) }
    });
    return json({ ok: true, counts, results, completedAt: new Date().toISOString() });
  } catch (cause) {
    return error(cause.code || "SYSTEM_TEST_FAILED", cause.message || "The requested service test could not be completed.", cause.status || 500, cause.details);
  }
};
