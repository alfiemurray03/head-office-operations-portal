import { cleanText, platformAudit } from "./_shared.js";
import { ensureCentralPlatformSchema, isoDate, jsonValue } from "./_central-schema.js";
import { resolvePlatformCustomer } from "./_central-access.js";

const SECURITY_PREFIXES = ["auth.","session.","security.","fraud.","identity.","account.takeover"];
const severityValue = value => ["information","low","moderate","high","critical"].includes(value) ? value : "information";
const currencyValue = value => {
  const code = cleanText(value,3).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
};

export async function updatePlatformProfile(env, platform, input = {}) {
  await ensureCentralPlatformSchema(env);
  const now = new Date().toISOString();
  const healthStatus = ["awaiting_connection","operational","degraded","maintenance","offline","disabled"].includes(input.healthStatus)
    ? input.healthStatus : "operational";
  const customerCount = Math.max(0,Number(input.customerCount || 0));
  const activeSessionCount = Math.max(0,Number(input.activeSessionCount || 0));
  const openErrorCount = Math.max(0,Number(input.openErrorCount || 0));
  await env.DB.prepare(`INSERT INTO platform_operational_profiles
    (platform_id,public_url,environment,hosting_provider,release_version,release_commit,health_status,health_message,
     capabilities_json,integrations_json,customer_count,active_session_count,open_error_count,last_heartbeat_at,
     last_deployment_at,last_customer_sync_at,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(platform_id) DO UPDATE SET
      public_url=COALESCE(excluded.public_url,platform_operational_profiles.public_url),environment=excluded.environment,
      hosting_provider=COALESCE(excluded.hosting_provider,platform_operational_profiles.hosting_provider),
      release_version=COALESCE(excluded.release_version,platform_operational_profiles.release_version),
      release_commit=COALESCE(excluded.release_commit,platform_operational_profiles.release_commit),
      health_status=excluded.health_status,health_message=excluded.health_message,
      capabilities_json=excluded.capabilities_json,integrations_json=excluded.integrations_json,
      customer_count=excluded.customer_count,active_session_count=excluded.active_session_count,
      open_error_count=excluded.open_error_count,last_heartbeat_at=excluded.last_heartbeat_at,
      last_deployment_at=COALESCE(excluded.last_deployment_at,platform_operational_profiles.last_deployment_at),
      metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind(platform.id,cleanText(input.publicUrl,500)||null,cleanText(input.environment,40)||"production",
      cleanText(input.hostingProvider,120)||null,cleanText(input.releaseVersion,120)||null,
      cleanText(input.releaseCommit,120)||null,healthStatus,cleanText(input.healthMessage,1000)||null,
      jsonValue(Array.isArray(input.capabilities)?input.capabilities.slice(0,100):[],[]),
      jsonValue(input.integrations&&typeof input.integrations==="object"?input.integrations:{},{}),
      customerCount,activeSessionCount,openErrorCount,now,isoDate(input.lastDeploymentAt,null),null,
      jsonValue(input.metadata&&typeof input.metadata==="object"?input.metadata:{},{}),now,now).run();
  const platformStatus = healthStatus === "operational" ? "active" : healthStatus === "disabled" ? "disabled"
    : healthStatus === "offline" ? "offline" : healthStatus === "awaiting_connection" ? "setup" : "degraded";
  await env.DB.prepare("UPDATE platforms SET status=?,last_health_check_at=?,updated_at=? WHERE id=?")
    .bind(platformStatus,now,now,platform.id).run();
  await env.DB.prepare(`INSERT INTO platform_heartbeats
    (id,platform_id,environment,health_status,health_message,release_version,release_commit,customer_count,
     active_session_count,open_error_count,metadata_json,occurred_at,received_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),platform.id,cleanText(input.environment,40)||"production",
      healthStatus,cleanText(input.healthMessage,1000)||null,cleanText(input.releaseVersion,120)||null,
      cleanText(input.releaseCommit,120)||null,customerCount,activeSessionCount,openErrorCount,
      jsonValue(input.metadata&&typeof input.metadata==="object"?input.metadata:{},{}),isoDate(input.occurredAt,now),now).run();
  if (input.deployment?.id) {
    const deployment = input.deployment;
    await env.DB.prepare(`INSERT INTO platform_deployments
      (id,platform_id,external_deployment_id,environment,release_version,commit_sha,status,deployed_at,metadata_json,received_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform_id,external_deployment_id) DO UPDATE SET
      release_version=excluded.release_version,commit_sha=excluded.commit_sha,status=excluded.status,
      deployed_at=excluded.deployed_at,metadata_json=excluded.metadata_json,received_at=excluded.received_at`)
      .bind(crypto.randomUUID(),platform.id,cleanText(deployment.id,180),cleanText(deployment.environment,40)||"production",
        cleanText(deployment.version,120)||null,cleanText(deployment.commit,120)||null,
        cleanText(deployment.status,60)||"unknown",isoDate(deployment.deployedAt,now),
        jsonValue(deployment.metadata&&typeof deployment.metadata==="object"?deployment.metadata:{},{}),now).run();
  }
  return { healthStatus,platformStatus,receivedAt:now };
}

export async function upsertCustomerSnapshot(env, platform, customer, input = {}) {
  await ensureCentralPlatformSchema(env);
  const now = new Date().toISOString();
  const platformAccountId = cleanText(input.platformCustomerId || input.platformAccountId,180);
  if (!platformAccountId) throw new Error("A platform account ID is required for the customer snapshot.");
  await env.DB.prepare(`INSERT INTO customer_platform_snapshots
    (id,customer_id,platform_id,platform_account_id,account_status,plan_code,subscription_status,entitlement_json,
     registered_at,last_sign_in_at,last_activity_at,data_classification,metadata_json,last_synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(customer_id,platform_id) DO UPDATE SET
    platform_account_id=excluded.platform_account_id,account_status=excluded.account_status,plan_code=excluded.plan_code,
    subscription_status=excluded.subscription_status,entitlement_json=excluded.entitlement_json,
    registered_at=COALESCE(excluded.registered_at,customer_platform_snapshots.registered_at),
    last_sign_in_at=COALESCE(excluded.last_sign_in_at,customer_platform_snapshots.last_sign_in_at),
    last_activity_at=COALESCE(excluded.last_activity_at,customer_platform_snapshots.last_activity_at),
    data_classification=excluded.data_classification,metadata_json=excluded.metadata_json,last_synced_at=excluded.last_synced_at`)
    .bind(crypto.randomUUID(),customer.id,platform.id,platformAccountId,cleanText(input.accountStatus,60)||"active",
      cleanText(input.planCode,100)||null,cleanText(input.subscriptionStatus,80)||null,
      jsonValue(input.entitlements&&typeof input.entitlements==="object"?input.entitlements:{},{}),
      isoDate(input.registeredAt,null),isoDate(input.lastSignInAt,null),isoDate(input.lastActivityAt,now),
      cleanText(input.dataClassification,80)||"customer_confidential",
      jsonValue(input.metadata&&typeof input.metadata==="object"?input.metadata:{},{}),now).run();
  await env.DB.prepare("UPDATE platform_operational_profiles SET last_customer_sync_at=?,updated_at=? WHERE platform_id=?")
    .bind(now,now,platform.id).run();
  return { lastSyncedAt:now };
}

async function upsertSession(env, platform, customer, session, occurredAt) {
  if (!session?.id) return;
  const status = ["active","revocation_required","revoked","expired","signed_out"].includes(session.status) ? session.status : "active";
  await env.DB.prepare(`INSERT INTO customer_sessions
    (id,customer_id,platform_id,external_session_id,status,started_at,last_seen_at,revoked_at,revocation_reason,
     device_summary,ip_country,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(platform_id,external_session_id) DO UPDATE SET status=excluded.status,last_seen_at=excluded.last_seen_at,
      revoked_at=COALESCE(excluded.revoked_at,customer_sessions.revoked_at),
      revocation_reason=COALESCE(excluded.revocation_reason,customer_sessions.revocation_reason),
      device_summary=COALESCE(excluded.device_summary,customer_sessions.device_summary),
      ip_country=COALESCE(excluded.ip_country,customer_sessions.ip_country),metadata_json=excluded.metadata_json`)
    .bind(crypto.randomUUID(),customer.id,platform.id,cleanText(session.id,220),status,
      isoDate(session.startedAt,occurredAt),isoDate(session.lastSeenAt,occurredAt),isoDate(session.revokedAt,null),
      cleanText(session.revocationReason,1000)||null,cleanText(session.deviceSummary,500)||null,
      cleanText(session.ipCountry,8)||null,jsonValue(session.metadata&&typeof session.metadata==="object"?session.metadata:{},{})).run();
}

async function upsertSubscription(env, platform, customer, subscription) {
  if (!subscription?.id) return;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO customer_subscriptions
    (id,customer_id,platform_id,provider,provider_customer_reference,provider_subscription_reference,
     plan_code,plan_name,status,amount_minor,currency,started_at,current_period_start,current_period_end,
     cancel_at_period_end,cancelled_at,metadata_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,provider_subscription_reference) DO UPDATE SET
    customer_id=excluded.customer_id,platform_id=excluded.platform_id,provider_customer_reference=excluded.provider_customer_reference,
    plan_code=excluded.plan_code,plan_name=excluded.plan_name,status=excluded.status,amount_minor=excluded.amount_minor,
    currency=excluded.currency,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    cancel_at_period_end=excluded.cancel_at_period_end,cancelled_at=excluded.cancelled_at,
    metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(),customer.id,platform.id,cleanText(subscription.provider,80)||"Stripe",
      cleanText(subscription.customerReference,200)||null,cleanText(subscription.id,220),
      cleanText(subscription.planCode,100)||null,cleanText(subscription.planName,160)||null,
      cleanText(subscription.status,80)||"unknown",Number.isFinite(Number(subscription.amountMinor))?Number(subscription.amountMinor):null,
      currencyValue(subscription.currency),isoDate(subscription.startedAt,null),isoDate(subscription.currentPeriodStart,null),
      isoDate(subscription.currentPeriodEnd,null),subscription.cancelAtPeriodEnd?1:0,isoDate(subscription.cancelledAt,null),
      jsonValue(subscription.metadata&&typeof subscription.metadata==="object"?subscription.metadata:{},{}),now).run();
}

async function upsertOrder(env, platform, customer, order) {
  if (!order?.id) return;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO customer_orders
    (id,customer_id,platform_id,provider,provider_order_reference,order_type,status,amount_minor,currency,
     created_at,completed_at,metadata_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(platform_id,provider_order_reference) DO UPDATE SET status=excluded.status,
      amount_minor=excluded.amount_minor,currency=excluded.currency,completed_at=excluded.completed_at,
      metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(),customer.id,platform.id,cleanText(order.provider,80)||null,cleanText(order.id,220),
      cleanText(order.type,100)||"subscription",cleanText(order.status,80)||"unknown",
      Number.isFinite(Number(order.amountMinor))?Number(order.amountMinor):null,currencyValue(order.currency),
      isoDate(order.createdAt,now),isoDate(order.completedAt,null),
      jsonValue(order.metadata&&typeof order.metadata==="object"?order.metadata:{},{}),now).run();
}

async function upsertPayment(env, platform, customer, payment, occurredAt) {
  if (!payment?.id) return;
  await env.DB.prepare(`INSERT INTO payment_references
    (id,customer_id,platform_id,provider,provider_customer_reference,provider_payment_reference,currency,
     amount_minor,status,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(provider,provider_payment_reference) DO UPDATE SET customer_id=excluded.customer_id,
      platform_id=excluded.platform_id,status=excluded.status,amount_minor=excluded.amount_minor,occurred_at=excluded.occurred_at`)
    .bind(crypto.randomUUID(),customer.id,platform.id,cleanText(payment.provider,80)||"Stripe",
      cleanText(payment.customerReference,200)||null,cleanText(payment.id,220),currencyValue(payment.currency)||"GBP",
      Math.max(0,Number(payment.amountMinor||0)),cleanText(payment.status,80)||"unknown",occurredAt,new Date().toISOString()).run();
}

export async function ingestPlatformEvent(env, platform, input = {}) {
  await ensureCentralPlatformSchema(env);
  const externalEventId = cleanText(input.externalEventId || input.id,220);
  const eventType = cleanText(input.eventType || input.type,160);
  if (!externalEventId || !eventType) throw Object.assign(new Error("An event ID and event type are required."),{code:"INVALID_PLATFORM_EVENT",status:400});
  const existing = await env.DB.prepare("SELECT processing_status FROM platform_webhook_events WHERE platform_id=? AND external_event_id=?")
    .bind(platform.id,externalEventId).first();
  if (existing?.processing_status === "processed") return { duplicate:true,externalEventId };
  const customer = await resolvePlatformCustomer(env,platform,input);
  const occurredAt = isoDate(input.occurredAt,new Date().toISOString());
  const receivedAt = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO platform_webhook_events
    (id,platform_id,external_event_id,event_type,entity_type,entity_external_id,received_at,processing_status,payload_hash)
    VALUES (?,?,?,?,?,?,?,'received',?) ON CONFLICT(platform_id,external_event_id) DO UPDATE SET
    event_type=excluded.event_type,received_at=excluded.received_at,processing_status='received'`)
    .bind(crypto.randomUUID(),platform.id,externalEventId,eventType,cleanText(input.entityType,80)||null,
      cleanText(input.entityExternalId,220)||null,receivedAt,cleanText(input.payloadHash,128)||"platform-signed").run();
  try {
    if (customer && input.snapshot) await upsertCustomerSnapshot(env,platform,customer,{...input.snapshot,platformCustomerId:input.platformCustomerId||input.snapshot.platformCustomerId});
    if (customer) await upsertSession(env,platform,customer,input.session,occurredAt);
    if (customer) await upsertSubscription(env,platform,customer,input.subscription);
    if (customer) await upsertOrder(env,platform,customer,input.order);
    if (customer) await upsertPayment(env,platform,customer,input.payment,occurredAt);
    if (SECURITY_PREFIXES.some(prefix=>eventType.startsWith(prefix))) {
      await env.DB.prepare(`INSERT INTO customer_security_events
        (id,external_event_id,customer_id,platform_id,event_type,severity,outcome,session_reference,ip_country,
         device_summary,occurred_at,received_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(platform_id,external_event_id) DO UPDATE SET outcome=excluded.outcome,severity=excluded.severity,
        metadata_json=excluded.metadata_json,received_at=excluded.received_at`)
        .bind(crypto.randomUUID(),externalEventId,customer?.id||null,platform.id,eventType,severityValue(input.severity),
          cleanText(input.outcome,80)||null,cleanText(input.session?.id,220)||null,cleanText(input.ipCountry,8)||null,
          cleanText(input.deviceSummary,500)||null,occurredAt,receivedAt,
          jsonValue(input.metadata&&typeof input.metadata==="object"?input.metadata:{},{})).run();
    }
    if (customer && (eventType.startsWith("fraud.") || Number(input.riskScore||0)>0)) {
      const riskScore = Math.min(100,Math.max(0,Number(input.riskScore||0)));
      const severity = severityValue(input.severity)==="information" ? (riskScore>=80?"critical":riskScore>=60?"high":riskScore>=30?"moderate":"low") : severityValue(input.severity);
      await env.DB.prepare(`INSERT INTO fraud_signals
        (id,customer_id,platform_id,source_event_id,signal_type,risk_score,severity,status,reason,evidence_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'open',?,?,?,?)`).bind(crypto.randomUUID(),customer.id,platform.id,externalEventId,eventType,
          riskScore,severity,cleanText(input.reason||input.summary,2000)||"Automated website risk signal.",
          jsonValue(input.metadata&&typeof input.metadata==="object"?input.metadata:{},{}),receivedAt,receivedAt).run();
    }
    if (customer) {
      await env.DB.prepare(`INSERT INTO customer_timeline_events
        (id,customer_id,platform_id,event_type,event_category,title,summary,occurred_at,source_reference,metadata_json)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),customer.id,platform.id,eventType,
          cleanText(input.category,80)||"platform_activity",cleanText(input.title,200)||eventType,
          cleanText(input.summary,2000)||null,occurredAt,externalEventId,
          jsonValue(input.metadata&&typeof input.metadata==="object"?input.metadata:{},{})).run();
      await env.DB.prepare("UPDATE customers SET last_activity_at=?,updated_at=? WHERE id=?").bind(occurredAt,receivedAt,customer.id).run();
    }
    await env.DB.prepare("UPDATE platform_webhook_events SET processing_status='processed',processed_at=? WHERE platform_id=? AND external_event_id=?")
      .bind(receivedAt,platform.id,externalEventId).run();
    await platformAudit(env,platform,`platform.${eventType}`,"platform_event",externalEventId,{
      label:cleanText(input.title,200)||eventType,reference:externalEventId,customerId:customer?.id||null,
      metadata:{customerNumber:customer?.customer_number||null}
    });
    return { duplicate:false,externalEventId,customerNumber:customer?.customer_number||null };
  } catch (error) {
    await env.DB.prepare("UPDATE platform_webhook_events SET processing_status='failed',error_code=? WHERE platform_id=? AND external_event_id=?")
      .bind(cleanText(error?.code||"PROCESSING_FAILED",100),platform.id,externalEventId).run();
    throw error;
  }
}
