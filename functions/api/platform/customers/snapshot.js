import { error, json, readJson, requirePlatform } from "../../../_shared.js";
import { resolvePlatformCustomer, calculateAccessDecision } from "../../../_central-access.js";
import { upsertCustomerSnapshot } from "../../../_central-events.js";

export const onRequestPost = async context => {
  const auth = await requirePlatform(context,["customers:write"]);
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request,96_000); }
  catch (cause) { return error(cause.code||"INVALID_REQUEST",cause.message,cause.status||400); }
  const customer = await resolvePlatformCustomer(context.env,auth.platform,body);
  if (!customer) return error("CUSTOMER_NOT_FOUND","Link the website account to a UCN before sending its account snapshot.",404);
  try {
    const snapshot = await upsertCustomerSnapshot(context.env,auth.platform,customer,body);
    const access = await calculateAccessDecision(context.env,customer,auth.platform,true);
    return json({accepted:true,customerNumber:customer.customer_number,snapshot,access},202);
  } catch (cause) {
    return error(cause.code||"CUSTOMER_SNAPSHOT_FAILED",cause.message||"The customer snapshot could not be stored.",cause.status||500);
  }
};
