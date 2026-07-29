import { error } from "../../_shared.js";

export const onRequestPost = async () => error(
  "STRIPE_DIVISION_REQUIRED",
  "Use the division-specific Stripe webhook endpoint for Planyx or Profile Centre.",
  410,
  {
    endpoints: [
      "/api/webhooks/stripe/planyx",
      "/api/webhooks/stripe/profile-centre"
    ]
  }
);
