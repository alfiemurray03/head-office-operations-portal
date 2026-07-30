import { error, json, requirePlatform } from "../../../_shared.js";
import { ageAssuranceDeployment } from "../../../_age-assurance.js";

function authorised(platform) {
  return platform.scopes.includes("security:read") || platform.scopes.includes("customers:write");
}

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth.response;
  if (!authorised(auth.platform)) {
    return error("INSUFFICIENT_PLATFORM_SCOPE", "The credential cannot read customer age-assurance policy.", 403);
  }
  const deployment = await ageAssuranceDeployment(context.env, auth.platform);
  return json({
    deployment,
    accountPopulation: "customers_only",
    staffAccountsExcluded: true,
    staffIdentitySystemAffected: false,
    enforcementStarted: deployment.enforcementActive
  }, 200);
};
