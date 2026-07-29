# Stripe Division Deployment and Reconciliation Runbook

## Required Cloudflare secrets

### Planyx

- `STRIPE_PLANYX_SECRET_KEY`
- `STRIPE_PLANYX_WEBHOOK_SECRET`
- `STRIPE_PLANYX_PUBLISHABLE_KEY` (optional)

### Profile Centre

- `STRIPE_PROFILE_CENTRE_SECRET_KEY`
- `STRIPE_PROFILE_CENTRE_WEBHOOK_SECRET`
- `STRIPE_PROFILE_CENTRE_PUBLISHABLE_KEY` (optional)

## Webhook destinations

Use Snapshot payloads only.

- Planyx: `https://customerops.jagroupservices.co.uk/api/webhooks/stripe/planyx`
- Profile Centre: `https://customerops.jagroupservices.co.uk/api/webhooks/stripe/profile-centre`

The old shared endpoint `/api/webhooks/stripe` is retired.

## Approved events

### Customer and payment operations

- `customer.created`
- `customer.updated`
- `customer.deleted`
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.succeeded`
- `charge.failed`
- `charge.updated`
- `charge.refunded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

### Refunds and disputes

- `refund.created`
- `refund.updated`
- `refund.failed`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`

### Product catalogue

- `product.created`
- `product.updated`
- `product.deleted`
- `price.created`
- `price.updated`
- `price.deleted`

These events keep new activity current immediately. Historical records and missed deliveries are recovered through reconciliation.

## Historical import and reconciliation

After migration `0012_stripe_reconciliation_and_catalog.sql` is applied, open **Stripe Control & Webhooks** and select **Import & reconcile all data**.

The import covers both Stripe divisions and retrieves:

- existing customers
- charges and Checkout Sessions
- subscriptions
- refunds
- disputes
- products and active/inactive prices
- Stripe balance transactions, including gross amounts, fees and net movements

Stripe list APIs are cursor-paginated. Head Office persists a checkpoint for every division and resource. If a large account cannot finish in one request, the run is marked `partial` and the next manual or automatic run continues from the saved cursor.

## Automatic reconciliation

The existing Head Office automation Worker calls:

```text
POST /api/automation/stripe/sync
```

once per hour using `AUTOMATION_SECRET`. The automatic run refreshes recent Stripe data for both divisions and repairs any delayed or missed webhook deliveries.

After deploying this release, redeploy the scheduled Worker:

```bash
npx wrangler deploy --config wrangler.customer-directory.jsonc
```

## Secret exposure response

When a signing secret or API key is shown in chat, email, source control, logs or a support ticket:

1. Roll the affected Stripe secret immediately.
2. Expire the exposed value.
3. Replace only the matching Cloudflare secret.
4. Trigger a new production deployment.
5. Test the API connection or send a signed test event and confirm a successful `2xx` result.

Never paste replacement secrets into GitHub, chat, tickets or documentation.

## Deployment order

1. Apply D1 migrations `0011_stripe_division_connectors.sql` and `0012_stripe_reconciliation_and_catalog.sql`.
2. Deploy the Pages application code.
3. Redeploy the hourly automation Worker.
4. Confirm both division API-key tests pass in Stripe Control & Webhooks.
5. Add the approved Snapshot events to both Stripe destinations.
6. Select **Import & reconcile all data**.
7. Confirm customers, transactions, refunds, disputes, products and prices appear under the correct division.
8. Send one signed test event to each endpoint and confirm successful `2xx` deliveries.
9. Confirm there are no failed webhook events or failed reconciliation runs.
