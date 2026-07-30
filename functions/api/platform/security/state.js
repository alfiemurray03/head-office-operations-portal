import { cleanText, error, json, requirePlatform } from "../../../_shared.js";
import { resolvePlatformCustomer } from "../../../_central-access.js";
import { ensureSecurityControlPlane, platformSecurityState } from "../../../_security-control-plane.js";

export const SECURITY_STATE_CONTRACT_VERSION = "ja-head-office-security-state-v1";

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ["security:read"]);
  if (auth.response) return auth.response;
  await ensureSecurityControlPlane(context.env);
  const url = new URL(context.request.url);
  const customerNumber = cleanText(url.searchParams.get("ucn") || url.searchParams.get("customerNumber"), 30);
  let customer = null;
  if (customerNumber) {
    customer = await resolvePlatformCustomer(context.env, auth.platform, { customerNumber });
    if (!customer) return error("CUSTOMER_NOT_FOUND", "The supplied UCN is not linked to a central customer record.", 404);
  }
  const state = await platformSecurityState(context.env, auth.platform, customer);
  const commands = await context.env.DB.prepare(`SELECT id,command,payload_json,created_at
    FROM platform_security_commands WHERE platform_id=? AND status='pending'
    ORDER BY created_at ASC LIMIT 50`).bind(auth.platform.id).all();
  const deliveredAt = new Date().toISOString();
  for (const command of commands.results || []) {
    await context.env.DB.prepare("UPDATE platform_security_commands SET status='delivered',delivered_at=? WHERE id=? AND status='pending'")
      .bind(deliveredAt, command.id).run();
  }
  return json({
    contractVersion: SECURITY_STATE_CONTRACT_VERSION,
    authority: "JA_GROUP_SERVICES_HEAD_OFFICE",
    dataClassification: "branch_security_instruction",
    confidentialReasoningWithheld: true,
    ...state,
    commands: (commands.results || []).map(command => ({
      id: command.id,
      command: command.command,
      payload: JSON.parse(command.payload_json || "{}"),
      createdAt: command.created_at
    })),
    generatedAt: deliveredAt
  }, 200, { "Cache-Control": "no-store" });
};
