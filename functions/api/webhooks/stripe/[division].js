import { handleStripeWebhook } from "../../../_stripe-webhook-handler.js";

export const onRequestPost = context => handleStripeWebhook(context, context.params.division);
