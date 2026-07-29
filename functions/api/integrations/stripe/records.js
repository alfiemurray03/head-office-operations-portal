import { cleanText, error, json } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { stripeDivisionRecords } from "../../../_stripe-control.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  const url = new URL(context.request.url);
  const division = cleanText(url.searchParams.get("division"), 80);
  if (!division) return error("STRIPE_DIVISION_REQUIRED", "Select Planyx or Profile Centre.", 400);
  try {
    const records = await stripeDivisionRecords(
      context.env,
      division,
      url.searchParams.get("q") || "",
      url.searchParams.get("limit") || 100
    );
    return json(records, 200, { "Cache-Control": "no-store" });
  } catch (cause) {
    return error(cause.code || "STRIPE_RECORDS_UNAVAILABLE", cause.message || "Stripe records could not be loaded.", cause.status || 500);
  }
};
