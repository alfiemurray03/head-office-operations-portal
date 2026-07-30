import { cleanText, error, json, readJson, requirePlatform } from "../../../_shared.js";
import { resolvePlatformCustomer } from "../../../_central-access.js";
import { ageAssuranceForAccess, requireAgeAssuranceSessionDeployment } from "../../../_age-assurance.js";
import { createIdentityVerification } from "../../../_didit-operations.js";

function authorised(platform) {
  return platform.scopes.includes("security:read") || platform.scopes.includes("customers:write");
}

function environmentWithMappedAgeWorkflow(env, workflowId) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "DIDIT_AGE_WORKFLOW_ID") return workflowId;
      return Reflect.get(target, property, receiver);
    }
  });
}

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth.response;
  if (!authorised(auth.platform)) {
    return error("INSUFFICIENT_PLATFORM_SCOPE", "The credential cannot request customer age assurance.", 403);
  }

  let body;
  try { body = await readJson(context.request, 32_768); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  if (body.consentAccepted !== true) {
    return error("AGE_ASSURANCE_CONSENT_REQUIRED", "The customer must be shown the age-assurance disclosure and accept it before a session is created.", 400);
  }
  const consentVersion = cleanText(body.consentVersion, 80);
  if (!consentVersion) return error("CONSENT_VERSION_REQUIRED", "Provide the disclosure version accepted by the customer.", 400);
  const consentRecordedAt = new Date().toISOString();

  const customer = await resolvePlatformCustomer(context.env, auth.platform, body);
  if (!customer) return error("CUSTOMER_NOT_FOUND", "The website account is not linked to a Unique Customer Number.", 404);

  let deployment;
  try { deployment = await requireAgeAssuranceSessionDeployment(context.env, auth.platform); }
  catch (cause) { return error(cause.code || "AGE_ASSURANCE_UNAVAILABLE", cause.message, cause.status || 503); }

  const current = await ageAssuranceForAccess(context.env, customer, auth.platform);
  if (current.satisfied) {
    return json({
      status: "already_verified",
      allowed: true,
      requiredAge: deployment.minimumAge,
      validUntil: current.evidence?.validUntil || null,
      decisionAuthority: "HEAD_OFFICE",
      accountPopulation: "customers_only",
      staffAccountsExcluded: true
    }, 200);
  }

  try {
    // A 16+ and an 18+ decision must never be created through an unqualified
    // shared workflow. Supply the workflow explicitly mapped and validated for
    // this connected website's threshold without mutating the request env.
    const verificationEnv = environmentWithMappedAgeWorkflow(context.env, deployment.workflowId);
    const result = await createIdentityVerification(verificationEnv, {
      ...auth.platform,
      actorType: "platform",
      sub: auth.platform.id,
      displayName: auth.platform.name
    }, {
      customerId: customer.id,
      purpose: "age_verification",
      requiredAge: deployment.minimumAge,
      accessMode: "request_only",
      scope: auth.platform.id,
      source: "platform_age_assurance",
      reason: `${auth.platform.name} requires Head Office confirmation that this customer is aged ${deployment.minimumAge} or over.`,
      sendNotificationEmails: true,
      consentRecordedAt,
      consentVersion
    });

    await context.env.DB.prepare(`UPDATE identity_verification_sessions
      SET consent_recorded_at=?,consent_version=? WHERE id=? AND customer_id=? AND verification_purpose='age_verification'`)
      .bind(consentRecordedAt, consentVersion, result.session.id, customer.id).run();

    return json({
      status: "verification_required",
      allowed: false,
      requiredAge: deployment.minimumAge,
      sessionId: result.session.id,
      providerSessionId: result.session.providerSessionId,
      verificationUrl: result.verificationUrl,
      decisionAuthority: "HEAD_OFFICE",
      accountPopulation: "customers_only",
      staffAccountsExcluded: true
    }, 201);
  } catch (cause) {
    return error(cause.code || "AGE_ASSURANCE_SESSION_FAILED", cause.message || "The age-assurance session could not be created.", cause.status || 502);
  }
};
