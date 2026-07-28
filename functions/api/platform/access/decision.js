import { error, json, readJson, requirePlatform } from "../../../_shared.js";
import { calculateAccessDecision, resolvePlatformCustomer } from "../../../_central-access.js";

function authorised(platform) {
  return platform.scopes.includes("security:read") || platform.scopes.includes("customers:write");
}

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth.response;
  if (!authorised(auth.platform)) return error("INSUFFICIENT_PLATFORM_SCOPE","The credential cannot request security decisions.",403);
  let body;
  try { body = await readJson(context.request, 32_768); }
  catch (cause) { return error(cause.code||"INVALID_REQUEST",cause.message,cause.status||400); }
  const customer = await resolvePlatformCustomer(context.env,auth.platform,body);
  if (!customer) return error("CUSTOMER_NOT_FOUND","The website account is not linked to a universal customer record.",404);
  const decision = await calculateAccessDecision(context.env,customer,auth.platform,true);
  return json({
    customer:{id:customer.id,customerNumber:customer.customer_number,accountStatus:customer.account_status,securityStatus:customer.security_status},
    platform:{id:auth.platform.id,code:auth.platform.code},
    access:decision
  },200);
};
