# JA Group Services Ltd — Central Payments

## Authority

Central Payments implements the Board-approved payment structure recorded on 4 August 2026. JA Group Services Ltd is the legal payment recipient and operates one principal Stripe account for directly sold products and services across the approved Sousa Murray brand family wherever technically, contractually and commercially appropriate.

Central Payments is part of the Head Office control architecture. Brand websites do not receive the unrestricted Stripe secret key. They authenticate to Head Office using scoped platform credentials and request governed payment operations.

## Approved brands

- JA Group Services Ltd
- Sousa Murray Domains
- Sousa Murray Sites
- Sousa Murray Planeia
- Sousa Murray Profiles
- Sousa Murray eLearning

Supplier-controlled arrangements, including payment flows required by third-party reseller platforms, remain outside Central Payments until separately reviewed and approved.

## Production architecture

```text
Sousa Murray website
        |
        | Head Office platform bearer credential
        | UCN + brand + product code + price code + return URLs
        v
JA Group Services Head Office Central Payments
        |
        | central product catalogue
        | security/restriction checks
        | one Stripe Customer per UCN where practicable
        v
JA Group Services Ltd — Central Payments Stripe account
        |
        | signed Stripe events
        v
Head Office central Stripe webhook
        |
        | central transaction/subscription records
        | platform event outbox
        v
Originating Sousa Murray website
```

## Cloudflare production configuration

The Head Office Pages project is the only application that requires the principal Stripe server credential.

Required variables/secrets:

| Name | Purpose |
|---|---|
| `CENTRAL_STRIPE_ACCOUNT_ID` | The approved Stripe account ID. For the newly designated account this should be set to `acct_1TD5VrDRkfgldp5x` after Head Office has confirmed that this is the verified JA Group Services Ltd account. |
| `CENTRAL_STRIPE_SECRET_KEY` | Live server-side secret or suitably scoped restricted key for the approved Central Payments Stripe account. Never commit this value. |
| `CENTRAL_STRIPE_WEBHOOK_SECRET` | Signing secret for the single Head Office Central Payments webhook. Never commit this value. |
| `CENTRAL_PAYMENTS_ENABLED` | Set to `true` only after account verification, webhook configuration, catalogue setup and acceptance testing are complete. |

Do not paste live secret keys into source code, browser code, GitHub issues, documentation, screenshots or chat messages.

## Stripe webhook

Production endpoint:

```text
https://customerops.jagroupservices.co.uk/api/webhooks/stripe
```

Subscribe the endpoint to:

- `customer.created`
- `customer.updated`
- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `refund.created`
- `refund.updated`
- `refund.failed`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

The webhook verifies Stripe's HMAC signature, rejects events outside the replay window, rejects live/test mode mismatches, stores each Stripe event idempotently and routes relevant outcomes back to the originating connected platform.

## Central product catalogue

Head Office owns the product and price catalogue. Each product has:

- approved brand code;
- internal product code;
- customer-facing product name;
- description and service type;
- Stripe Product ID; and
- status.

Each price has:

- internal price code;
- Stripe Price ID;
- amount and currency;
- one-off or recurring billing type;
- recurring interval where applicable;
- tax behaviour; and
- status.

Connected websites submit internal `productCode` and `priceCode`; they do not submit an arbitrary Stripe Product or Price ID.

## Customer identity

Where practicable there is one Stripe Customer per central JA Group Services customer.

The relationship is:

```text
JA Group Services UCN
       -> Universal Customer Record
       -> central_payment_customer_links
       -> Stripe Customer
```

Stripe customer and payment metadata carries the UCN, central customer ID, legal entity, originating platform, brand and service information.

Email is contact data and is not the primary payment identity.

## Checkout API

Endpoint:

```text
POST /api/v1/payments/checkout
```

Required platform scope:

```text
payments:checkout
```

Example request:

```json
{
  "brand": "SOUSA_MURRAY_ELEARNING",
  "productCode": "ELEARNING_LIBRARY",
  "priceCode": "LEARNER_PLUS_MONTHLY",
  "customerNumber": "1234567890",
  "orderReference": "SME-ORDER-10001",
  "serviceReference": "learning-library",
  "successUrl": "https://sousamurrayelearning.jagroupservices.co.uk/lms/checkout/success",
  "cancelUrl": "https://sousamurrayelearning.jagroupservices.co.uk/plans?checkout=cancelled"
}
```

The service:

1. authenticates the connected platform;
2. confirms the platform is authorised to transact for that brand;
3. resolves the UCN to the Universal Customer Record;
4. checks active Head Office restrictions with `deny_payment` enforcement;
5. resolves the approved internal product and price codes;
6. confirms success/cancel origins are authorised for that platform;
7. verifies the configured Stripe key belongs to the approved Central Payments account;
8. creates or reuses the single central Stripe Customer;
9. creates a hosted Stripe Checkout Session; and
10. records the central checkout request and audit event.

## Return-origin control

Return URLs are not trusted merely because a platform sends them.

Head Office staff must authorise the exact HTTPS origin for each connected platform in the Central Payments workspace. Checkout and Billing Portal creation reject any return URL whose origin is not active in `central_payment_platform_origins`.

## Routed platform events

Stripe events are recorded centrally. When an event belongs to a connected platform, Head Office adds a sanitised operational event to that platform's outbox.

Read pending events:

```text
GET /api/v1/payments/events
```

Acknowledge processed events:

```text
POST /api/v1/payments/events
```

```json
{ "eventIds": ["event-record-id"] }
```

Required scope:

```text
payments:status
```

The platform receives operational fields such as event type, Stripe object reference, brand/product/price code, UCN, order/service reference, status and amount. It does not receive the Head Office Stripe secret or confidential Head Office security information.

## Payment status API

```text
GET /api/v1/payments/status?orderReference=...
GET /api/v1/payments/status?customerNumber=...
GET /api/v1/payments/status?reference=...
```

The authenticated platform can see only records associated with its own platform ID.

## Billing Portal API

```text
POST /api/v1/payments/portal
```

Required scope:

```text
payments:portal
```

The central service creates the Stripe Billing Portal Session for the customer's central Stripe Customer and validates the return URL against the platform origin allow-list.

## Platform credentials

Brand websites should receive a Head Office platform credential containing only the permissions they need. Typical payment scopes are:

- `payments:checkout`
- `payments:status`
- `payments:portal`

`payments:customer` is reserved for future customer-payment operations and should not be granted unless required.

No connected website should receive `CENTRAL_STRIPE_SECRET_KEY` or `CENTRAL_STRIPE_WEBHOOK_SECRET`.

## Head Office operational workspace

The existing Head Office **Subscriptions, payments & refunds** workspace is enhanced with Central Payments controls for authorised staff. It displays:

- service readiness;
- approved Stripe account status;
- linked customer count;
- product/price catalogue;
- open central checkouts;
- active subscriptions;
- pending platform events;
- authorised return origins; and
- recent central checkout records.

Staff with `payments:write` can create governed Stripe Products and Prices and manage platform return origins.

## Go-live sequence

1. Verify that `acct_1TD5VrDRkfgldp5x` is held in the verified legal name of JA Group Services Ltd and is the Board-approved principal account.
2. Put that account's server secret in Head Office Cloudflare as `CENTRAL_STRIPE_SECRET_KEY`.
3. Set `CENTRAL_STRIPE_ACCOUNT_ID=acct_1TD5VrDRkfgldp5x`.
4. Deploy the Head Office Central Payments code with `CENTRAL_PAYMENTS_ENABLED` unset or `false`.
5. Open Head Office → Subscriptions, payments & refunds and confirm the account verification badge passes.
6. Create the central Stripe webhook and store its signing secret as `CENTRAL_STRIPE_WEBHOOK_SECRET`.
7. Create/approve Central Payments products and prices from Head Office.
8. Authorise each brand site's exact HTTPS origin.
9. Generate new scoped platform credentials for the brand sites.
10. Migrate one low-risk brand/payment flow first and perform a live controlled purchase/refund/cancellation test.
11. Confirm the webhook, central transaction record and routed platform event are all correct.
12. Set `CENTRAL_PAYMENTS_ENABLED=true` only when the acceptance test has passed.
13. Migrate remaining directly sold brand services in controlled stages.
14. Keep legacy Stripe integrations/accounts available until customers, subscriptions, refunds, disputes, reporting and record-retention obligations have been reviewed.

## Migration rule

Central Payments does not automatically move or close existing Stripe accounts. Existing arrangements must be reviewed before migration. Supplier-controlled payment services remain subject to their supplier agreements and operational constraints.
