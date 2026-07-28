import { error, json, requirePlatform } from "../../_shared.js";
import { ensureCentralPlatformSchema } from "../../_central-schema.js";

function authorised(platform) {
  return platform.scopes.includes("security:read") || platform.scopes.includes("customers:write");
}

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth.response;
  if (!authorised(auth.platform)) return error("INSUFFICIENT_PLATFORM_SCOPE","The credential cannot receive enforcement commands.",403);
  await ensureCentralPlatformSchema(context.env);
  const now = new Date().toISOString();
  const result = await context.env.DB.prepare(`SELECT c.id,c.command,c.reason,c.created_at,c.restriction_id,
      u.customer_number,u.display_name,a.external_account_id platform_customer_id
    FROM platform_enforcement_commands c
    JOIN customers u ON u.id=c.customer_id
    LEFT JOIN customer_platform_accounts a ON a.customer_id=c.customer_id AND a.platform_id=c.platform_id
    WHERE c.platform_id=? AND c.status IN ('pending','delivered') ORDER BY c.created_at LIMIT 100`)
    .bind(auth.platform.id).all();
  const ids = result.results.map(item=>item.id);
  if (ids.length) {
    const placeholders = ids.map(()=>"?").join(",");
    await context.env.DB.prepare(`UPDATE platform_enforcement_commands SET status='delivered',delivered_at=COALESCE(delivered_at,?)
      WHERE id IN (${placeholders})`).bind(now,...ids).run();
  }
  return json({commands:result.results,deliveredAt:now});
};
