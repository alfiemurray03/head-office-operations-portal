import { json } from "../_shared.js";
import { ensureOperationsReady } from "../_operations.js";
import { ensureProductionSchema } from "../_schema-bootstrap.js";
import { ensureProductionCatalogues } from "../_catalogue-bootstrap.js";
import { ensureV7Schema } from "../_v7-schema.js";

export const onRequestGet = async ({ env }) => {
  let database = "unavailable";
  let operationsSchema = "unavailable";
  let version7Schema = "unavailable";
  try {
    const row = await env.DB.prepare("SELECT 1 ok").first();
    if (Number(row?.ok) === 1) database = "connected";
    await ensureProductionSchema(env);
    await ensureProductionCatalogues(env);
    await ensureOperationsReady(env);
    await ensureV7Schema(env);
    const state = await env.DB.prepare("SELECT version FROM operational_schema_state WHERE schema_key='production_system'").first();
    if (Number(state?.version || 0) >= 1) operationsSchema = "ready";
    const v7 = await env.DB.prepare("SELECT COUNT(*) count FROM detection_rules WHERE enabled=1").first();
    if (Number(v7?.count || 0) >= 10) version7Schema = "ready";
  } catch (error) {
    console.error(JSON.stringify({ event: "health_check_failed", message: error instanceof Error ? error.message : "Unknown health error" }));
  }
  const operational = database === "connected" && operationsSchema === "ready" && version7Schema === "ready";
  return json({
    status: operational ? "operational" : "degraded",
    service: "Head Office Operations Centre",
    revision: "version-7.0.0",
    environment: env.APP_ENV || "Production",
    database,
    operationsSchema,
    version7Schema,
    checkedAt: new Date().toISOString()
  }, operational ? 200 : 503);
};
