import { assertSameOrigin, audit, error, json } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { CUSTOMER_DIRECTORY_CONNECTOR_ID, testCustomerDirectory } from "../../_customer-entra.js";

export const onRequestPost = async context => {
  const originError = assertSameOrigin(context.request);
  if (originError) return originError;
  const auth = await requirePermission(context, "administration:write");
  if (auth.response) return auth.response;
  try {
    const result = await testCustomerDirectory(context.env);
    await audit(context.env, auth.session, "customer_directory.connection_tested", "customer_directory_connector", CUSTOMER_DIRECTORY_CONNECTOR_ID, {
      label: "Microsoft customer directory connection tested",
      reference: "JA Group Services ID",
      requestId: context.data.requestId,
      after: { connected: result.connected, sampleAvailable: result.sampleAvailable }
    });
    return json(result);
  } catch (cause) {
    return error(cause.code || "CUSTOMER_DIRECTORY_TEST_FAILED", cause.message || "The Microsoft customer directory connection test failed.", cause.status || 502, cause.details);
  }
};
