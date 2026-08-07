# Sousa Murray eLearning free course trial

The governed trial product is **AI Literacy for Everyday Work — 7-day trial**.

- Brand: `SOUSA_MURRAY_ELEARNING`
- Product code: `ELEARNING_AI_LITERACY_TRIAL`
- Price code: `ELEARNING_AI_LITERACY_TRIAL_FREE`
- Amount: GBP 0.00
- Billing type: one-time
- Checkout: JA Group Services Central Payments using Stripe-hosted Checkout

The no-cost order deliberately remains a Checkout Session so the customer journey, central customer/UCN association, Head Office audit trail and Stripe completion event are exercised exactly as they are for paid commerce. Stripe does not create a PaymentIntent for a zero-total Checkout order, so fulfilment is driven by the verified `checkout.session.completed` event and Checkout Session metadata.

The eLearning platform enforces one trial claim per learning account and applies the seven-day course-access expiry in the Sousa Murray LMS. The Head Office price remains a governed catalogue item rather than a client-supplied amount.

After deployment, run the existing idempotent **Provision standard catalogue** control in the Central Payments workspace once so the new Product and £0.00 Price are created in the approved JA Group Services Ltd Stripe account and written to the Head Office catalogue tables.
