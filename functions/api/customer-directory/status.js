import { error, json } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { CUSTOMER_DIRECTORY_CONNECTOR_ID, customerDirectoryConfigured, ensureCustomerDirectorySchema } from "../../_customer-entra.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "platforms:read");
  if (auth.response) return auth.response;
  try {
    await ensureCustomerDirectorySchema(context.env);
    const connector = await context.env.DB.prepare("SELECT * FROM customer_directory_connectors WHERE id=?")
      .bind(CUSTOMER_DIRECTORY_CONNECTOR_ID).first();
    const [identityCounts, reviews, runs, identities] = await context.env.DB.batch([
      context.env.DB.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END) linked,
        SUM(CASE WHEN directory_status='review_required' THEN 1 ELSE 0 END) review_required,
        SUM(CASE WHEN directory_status='disabled' THEN 1 ELSE 0 END) disabled,
        SUM(CASE WHEN directory_status='deleted' THEN 1 ELSE 0 END) deleted
        FROM customer_directory_identities WHERE connector_id=?`).bind(CUSTOMER_DIRECTORY_CONNECTOR_ID),
      context.env.DB.prepare(`SELECT r.id,r.review_type,r.status,r.reason,r.created_at,r.proposed_customer_id,
        i.id identity_id,i.display_name,i.primary_email,i.object_id,c.customer_number proposed_customer_number,c.display_name proposed_customer_name
        FROM customer_directory_reviews r JOIN customer_directory_identities i ON i.id=r.identity_id
        LEFT JOIN customers c ON c.id=r.proposed_customer_id
        WHERE r.connector_id=? AND r.status='open' ORDER BY r.created_at ASC LIMIT 100`).bind(CUSTOMER_DIRECTORY_CONNECTOR_ID),
      context.env.DB.prepare(`SELECT id,mode,status,started_at,completed_at,pages_processed,users_received,customers_created,
        customers_updated,identities_linked,review_items_created,disabled_accounts,deleted_accounts,error_code,error_message
        FROM customer_directory_sync_runs WHERE connector_id=? ORDER BY started_at DESC LIMIT 20`).bind(CUSTOMER_DIRECTORY_CONNECTOR_ID),
      context.env.DB.prepare(`SELECT i.id,i.customer_id,i.object_id,i.display_name,i.primary_email,i.account_enabled,i.directory_status,
        i.source_created_at,i.last_synced_at,c.customer_number,c.account_status,c.security_status
        FROM customer_directory_identities i LEFT JOIN customers c ON c.id=i.customer_id
        WHERE i.connector_id=? ORDER BY i.last_synced_at DESC LIMIT 200`).bind(CUSTOMER_DIRECTORY_CONNECTOR_ID)
    ]);
    return json({
      configured: customerDirectoryConfigured(context.env),
      connector: connector ? {
        id: connector.id,
        provider: connector.provider,
        tenantId: connector.tenant_id,
        displayName: connector.display_name,
        status: connector.status,
        lastTestedAt: connector.last_tested_at,
        lastSyncStartedAt: connector.last_sync_started_at,
        lastSyncCompletedAt: connector.last_sync_completed_at,
        lastSuccessAt: connector.last_success_at,
        lastErrorCode: connector.last_error_code,
        lastErrorMessage: connector.last_error_message,
        deltaReady: Boolean(connector.delta_link)
      } : null,
      counts: identityCounts.results[0] || {},
      reviews: reviews.results,
      runs: runs.results,
      identities: identities.results
    });
  } catch (cause) {
    return error(cause.code || "CUSTOMER_DIRECTORY_STATUS_FAILED", cause.message || "The customer directory status could not be loaded.", cause.status || 500);
  }
};
