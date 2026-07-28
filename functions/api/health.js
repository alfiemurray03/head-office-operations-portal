import { json } from "../_shared.js";

export const onRequestGet = async ({ env }) => {
  let database = "unavailable";
  try {
    const row = await env.DB.prepare("SELECT 1 ok").first();
    if (Number(row?.ok) === 1) database = "connected";
  } catch {}
  return json({
    status: database === "connected" ? "operational" : "degraded",
    service: "Head Office Operations Centre",
    revision: "production-system-v1",
    environment: env.APP_ENV || "Production",
    database,
    checkedAt: new Date().toISOString()
  }, database === "connected" ? 200 : 503);
};
