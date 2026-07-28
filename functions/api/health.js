import { json } from "../_shared.js";
import { ensureOperationsReady } from "../_operations.js";

export const onRequestGet = async ({ env }) => {
  let database = "unavailable";
  let operationsSchema = "unavailable";
  try {
    const row = await env.DB.prepare("SELECT 1 ok").first();
    if (Number(row?.ok) === 1) database = "connected";
    await ensureOperationsReady(env);
    const state = await env.DB.prepare("SELECT version FROM operational_schema_state WHERE schema_key='production_system'").first();
    if (Number(state?.version || 0) >= 1) operationsSchema = "ready";
  } catch (error) {
    console.error(JSON.stringify({ event: "health_check_failed", message: error instanceof Error ? error.message : "Unknown health error" }));
  }
  const operational = database === "connected" && operationsSchema === "ready";
  return json({
    status: operational ? "operational" : "degraded",
    service: "Head Office Operations Centre",
    revision: "production-system-v1",
    environment: env.APP_ENV || "Production",
    database,
    operationsSchema,
    checkedAt: new Date().toISOString()
  }, operational ? 200 : 503);
};
