import { cleanText } from "./_shared.js";
import { ensureSystemSettingsReady, getSystemSetting } from "./_system-settings.js";

const DEPLOYMENTS = Object.freeze({
  PLANYX: Object.freeze({
    code: "PLANYX",
    name: "Planyx",
    statusKey: "age_assurance.planyx_status",
    minimumAgeKey: "age_assurance.planyx_minimum_age",
    validatedKey: "age_assurance.planyx_threshold_validated"
  }),
  PROFILE_CENTRE: Object.freeze({
    code: "PROFILE_CENTRE",
    name: "Profile Centre",
    statusKey: "age_assurance.profile_centre_status",
    minimumAgeKey: "age_assurance.profile_centre_minimum_age",
    validatedKey: "age_assurance.profile_centre_threshold_validated"
  })
});

const DEPLOYMENT_STATUSES = new Set(["disabled", "paused", "enabled"]);
const schemaReady = new WeakMap();

async function addColumnIfMissing(env, columnName, definition) {
  const columns = await env.DB.prepare("PRAGMA table_info(identity_verification_sessions)").all();
  if ((columns.results || []).some(column => column.name === columnName)) return;
  await env.DB.prepare(`ALTER TABLE identity_verification_sessions ADD COLUMN ${definition}`).run();
}

export async function ensureAgeAssuranceSchema(env) {
  if (!env?.DB) throw new Error("The Head Office customer database is unavailable.");
  if (schemaReady.has(env.DB)) return schemaReady.get(env.DB);
  const promise = (async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS identity_verification_sessions (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      platform_id TEXT REFERENCES platforms(id),
      restriction_id TEXT REFERENCES restrictions(id),
      provider TEXT NOT NULL DEFAULT 'didit',
      provider_session_id TEXT NOT NULL UNIQUE,
      workflow_id TEXT,
      environment TEXT NOT NULL DEFAULT 'live',
      status TEXT NOT NULL DEFAULT 'Not Started',
      decision TEXT,
      verification_url_hash TEXT,
      vendor_data TEXT NOT NULL,
      return_url TEXT,
      consent_recorded_at TEXT,
      consent_version TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      expires_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    )`).run();
    await addColumnIfMissing(env, "verification_purpose", "verification_purpose TEXT");
    await addColumnIfMissing(env, "required_age", "required_age INTEGER");
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_identity_verification_age_assurance
      ON identity_verification_sessions(customer_id,verification_purpose,status,required_age,completed_at DESC)`).run();
    await ensureSystemSettingsReady(env);
    return true;
  })();
  schemaReady.set(env.DB, promise);
  try { return await promise; }
  catch (error) { schemaReady.delete(env.DB); throw error; }
}

function deploymentDefinition(platform) {
  const code = cleanText(platform?.code || platform, 80).toUpperCase();
  return DEPLOYMENTS[code] || null;
}

export async function ageAssuranceDeployment(env, platform) {
  await ensureAgeAssuranceSchema(env);
  const definition = deploymentDefinition(platform);
  if (!definition) {
    return {
      configured: false,
      platformCode: cleanText(platform?.code || platform, 80).toUpperCase() || null,
      platformName: cleanText(platform?.name, 120) || null,
      accountPopulation: "customers_only",
      staffAccountsExcluded: true,
      status: "disabled",
      minimumAge: null,
      thresholdValidated: false,
      masterEnabled: false,
      enforcementActive: false
    };
  }

  const [statusValue, minimumAgeValue, validatedValue, masterValue, validityDaysValue] = await Promise.all([
    getSystemSetting(env, definition.statusKey, "disabled"),
    getSystemSetting(env, definition.minimumAgeKey, definition.code === "PLANYX" ? 16 : 18),
    getSystemSetting(env, definition.validatedKey, false),
    getSystemSetting(env, "age_assurance.enforcement_master_enabled", false),
    getSystemSetting(env, "age_assurance.result_validity_days", 365)
  ]);
  const status = DEPLOYMENT_STATUSES.has(String(statusValue)) ? String(statusValue) : "disabled";
  const minimumAge = Math.max(13, Math.min(25, Number(minimumAgeValue) || (definition.code === "PLANYX" ? 16 : 18)));
  const masterEnabled = masterValue === true;
  const thresholdValidated = validatedValue === true;
  const providerReady = Boolean(cleanText(env.DIDIT_API_KEY, 500) && cleanText(env.DIDIT_AGE_WORKFLOW_ID, 180));

  return {
    configured: true,
    platformCode: definition.code,
    platformName: definition.name,
    accountPopulation: "customers_only",
    staffAccountsExcluded: true,
    status,
    minimumAge,
    thresholdValidated,
    masterEnabled,
    providerReady,
    resultValidityDays: Math.max(30, Math.min(1095, Number(validityDaysValue) || 365)),
    enforcementActive: masterEnabled && status !== "disabled",
    newSessionsAllowed: masterEnabled && status === "enabled" && thresholdValidated && providerReady
  };
}

export async function listAgeAssuranceDeployments(env) {
  const [planyx, profileCentre] = await Promise.all([
    ageAssuranceDeployment(env, "PLANYX"),
    ageAssuranceDeployment(env, "PROFILE_CENTRE")
  ]);
  return {
    staffAccountsExcluded: true,
    accountPopulation: "customers_only",
    enforcementStarted: [planyx, profileCentre].some(item => item.enforcementActive),
    deployments: [planyx, profileCentre]
  };
}

function evidenceValidUntil(row, validityDays) {
  if (row?.expires_at) {
    const explicit = new Date(row.expires_at);
    if (!Number.isNaN(explicit.getTime())) return explicit;
  }
  const completed = new Date(row?.completed_at || row?.updated_at || row?.created_at || 0);
  if (Number.isNaN(completed.getTime())) return null;
  return new Date(completed.getTime() + validityDays * 86_400_000);
}

async function qualifyingEvidence(env, customerId, deployment) {
  const row = await env.DB.prepare(`SELECT id,provider_session_id,workflow_id,required_age,created_at,updated_at,completed_at,expires_at
    FROM identity_verification_sessions
    WHERE customer_id=? AND verification_purpose='age_verification' AND status='Approved' AND required_age>=?
    ORDER BY required_age DESC,completed_at DESC,updated_at DESC LIMIT 1`)
    .bind(customerId, deployment.minimumAge).first();
  if (!row) return null;
  const validUntil = evidenceValidUntil(row, deployment.resultValidityDays);
  if (!validUntil || validUntil.getTime() <= Date.now()) return null;
  return {
    sessionId: row.id,
    providerSessionId: row.provider_session_id,
    workflowId: row.workflow_id,
    confirmedMinimumAge: Number(row.required_age),
    validUntil: validUntil.toISOString()
  };
}

export async function ageAssuranceForAccess(env, customer, platform) {
  const deployment = await ageAssuranceDeployment(env, platform);
  const base = {
    ...deployment,
    required: false,
    satisfied: false,
    decision: "not_required",
    reason: "No active Head Office age-assurance deployment applies to this customer service.",
    evidence: null
  };

  if (!deployment.configured || !deployment.masterEnabled || deployment.status === "disabled") return base;

  if (!deployment.thresholdValidated) {
    return {
      ...base,
      required: true,
      decision: "deny",
      reason: "The age-assurance deployment has not passed its threshold-validation control."
    };
  }

  const evidence = await qualifyingEvidence(env, customer.id, deployment);
  if (evidence) {
    return {
      ...base,
      required: true,
      satisfied: true,
      decision: "allow",
      reason: `Head Office holds valid ${deployment.minimumAge}+ age assurance for this customer.`,
      evidence
    };
  }

  if (deployment.status === "paused") {
    return {
      ...base,
      required: true,
      decision: "deny",
      reason: "Age assurance is temporarily paused. Existing valid assurance remains accepted, but a new check cannot currently be started."
    };
  }

  if (!deployment.providerReady) {
    return {
      ...base,
      required: true,
      decision: "deny",
      reason: "The Didit age-assurance provider configuration is not ready for new customer sessions."
    };
  }

  return {
    ...base,
    required: true,
    decision: "step_up",
    reason: `${deployment.minimumAge}+ age assurance is required before this customer may continue.`
  };
}

export async function requireAgeAssuranceSessionDeployment(env, platform) {
  const deployment = await ageAssuranceDeployment(env, platform);
  if (!deployment.configured) {
    throw Object.assign(new Error("This connected website has no Head Office age-assurance deployment."), {
      code: "AGE_ASSURANCE_NOT_DEPLOYED",
      status: 404
    });
  }
  if (!deployment.masterEnabled || deployment.status === "disabled") {
    throw Object.assign(new Error("Age-assurance enforcement has not been started for this website."), {
      code: "AGE_ASSURANCE_NOT_ENFORCING",
      status: 409
    });
  }
  if (deployment.status === "paused") {
    throw Object.assign(new Error("Age assurance is paused for this website. Existing valid results remain recognised, but new sessions are unavailable."), {
      code: "AGE_ASSURANCE_PAUSED",
      status: 503
    });
  }
  if (!deployment.thresholdValidated || !deployment.providerReady) {
    throw Object.assign(new Error("The age-assurance deployment has not passed its workflow and threshold readiness check."), {
      code: "AGE_ASSURANCE_NOT_READY",
      status: 503
    });
  }
  return deployment;
}

export { DEPLOYMENT_STATUSES };
