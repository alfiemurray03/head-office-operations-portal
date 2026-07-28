# Version 7 Stripe Webhook Setup

## Endpoint

Configure the Stripe webhook destination as:

`https://customerops.jagroupservices.co.uk/api/webhooks/stripe`

Do not enable the endpoint in production until Version 7 has been deployed and the health endpoint reports `version7Schema: ready`.

## Cloudflare secrets

Configure these as encrypted production secrets:

- `STRIPE_WEBHOOK_SECRET` — the `whsec_...` secret for this exact Stripe endpoint;
- `RISK_HASH_SECRET` — a separate high-entropy secret used to create one-way payment-method correlation hashes.

The test endpoint and live endpoint have different webhook secrets. Never commit either secret.

## Event selection

Enable only the events the adapter handles:

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `refund.created`
- `refund.failed`
- `refund.updated`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`
- `review.opened`
- `review.closed`

Avoid enabling both PaymentIntent success/failure and equivalent Charge success/failure events for the same transaction, as that creates duplicate business signals.

## Customer linking

For reliable universal-customer matching, include one of these Stripe metadata values when creating the PaymentIntent:

- `customer_number`
- `universal_customer_number`
- `customerNumber`

The value must be the ten-digit Head Office universal customer number.

Where metadata is unavailable, Version 7 attempts to use an existing Stripe customer-reference or transaction-reference link from the payment ledger.

## Data handling

The adapter:

- verifies the raw request body against the `Stripe-Signature` header;
- rejects signatures older than five minutes;
- rejects bodies larger than 256 KB;
- de-duplicates using the Stripe event ID;
- records payment, refund or dispute references;
- sends the normalised signal through the Version 7 risk engine; and
- hashes any available card fingerprint before storage.

The adapter does not store full card numbers, security codes or Stripe secret keys.

## Test procedure

1. Configure a Stripe test-mode webhook and its test endpoint secret.
2. Submit a signed `payment_intent.payment_failed` test event.
3. Confirm the endpoint returns HTTP 200.
4. Confirm a `payment.failed` event appears in Risk Intelligence.
5. Repeat the same Stripe event and confirm it is treated as a duplicate.
6. Submit a stale or altered signature and confirm HTTP 400.
7. Submit `refund.created` above the configured threshold and confirm an alert is created.
8. Submit `charge.dispute.created` and confirm an R3/A3 signal and alert.
9. Confirm no raw Stripe secret, card number or fingerprint appears in logs.
10. Repeat in live mode only after the test evidence is retained.
