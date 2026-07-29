# Stripe Division Deployment Runbook

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

- `customer.created`
- `customer.updated`
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

## Secret exposure response

When a signing secret is shown in chat, email, source control, logs or a support ticket:

1. Roll the affected Stripe destination secret immediately.
2. Expire the exposed secret.
3. Replace only the matching Cloudflare variable.
4. Trigger a new production deployment.
5. Send a signed test event and confirm a successful `2xx` delivery.

Never paste replacement secrets into GitHub, chat, tickets or documentation.

## Deployment order

1. Apply D1 migration `0011_stripe_division_connectors.sql`.
2. Deploy the application code.
3. Confirm both division API-key tests pass in Stripe Control & Webhooks.
4. Enable the Planyx Snapshot destination.
5. Enable the Profile Centre Snapshot destination.
6. Send one test event to each endpoint.
7. Confirm records appear under the correct division and no failed deliveries remain.
