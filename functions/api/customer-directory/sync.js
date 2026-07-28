import { assertSameOrigin, audit, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { CUSTOMER_DIRECTORY_CONNECTOR_ID } from "../../_customer-entra.js";
import { syncCustomerDirectory } from "../../_customer-entra-sync.js";

export const onRequestPost = async context => {
  const originError = assertSameOrigin(context.request);
  if (originError) return originError;
  const auth = await requirePermission(context, "administration:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const mode = body.mode === "full" ? "full" : "delta";
  try {
    const result = await syncCustomerDirectory(context.env, mode, auth.session.sub);
    await audit(context.env, auth.session, "customer_directory.synchronised", "customer_directory_connector", CUSTOMER_DIRECTORY_CONNECTOR_ID, {
      label: mode === "full" ? "Full Microsoft customer import completed" : "Microsoft customer directory changes synchronised",
      reference: "JA Group Services ID",
      requestId: context.data.requestId,
      after: { mode: result.mode, runId: result.runId, stats: result.stats, totals: result.totals }
    });
    return json(result);
  } catch (cause) {
    return error(cause.code || "CUSTOMER_DIRECTORY_SYNC_FAILED", cause.message || "The Microsoft customer directory could not be synchronised.", cause.status || 502, cause.details);
  }
};
