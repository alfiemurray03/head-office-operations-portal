# Head Office Security Operations Integration

## Purpose

The Head Office Operations Portal is the central authority for JA Group Services customer identity, Unique Customer Numbers (UCNs), security markers, customer restrictions, fraud signals and critical website-security lockdowns.

Connected websites remain responsible for their own normal launch gates, maintenance mode and local availability controls. A Head Office security lockdown is a separate emergency control which takes precedence only while it is active.

## Connected-site precedence

Every connected website must evaluate access in this order:

1. **Head Office critical security lockdown** — deny normal customer access and show the website's security-lockdown experience.
2. **The website's own maintenance or launch gate** — apply the site's locally configured state.
3. **The customer's Head Office access decision** — allow, deny, require step-up verification or place the action under review.
4. **The website's normal authorisation and entitlement rules**.

A connected website must never initiate a Head Office lockdown itself. It may report a critical event, but an authorised Head Office user must review the notification and initiate the lockdown manually.

## Platform authentication

Generate a scoped connector credential in **Connected websites & services**. Store it as an encrypted secret in the connected website. Do not place it in public JavaScript, source control, logs, email or support tickets.

Required scope for the security contract:

- `security:read`

Additional scopes are issued only where required:

- `customers:read`
- `customers:write`
- `events:write`
- `platform:write`

## Retrieve authoritative security state

Request:

```http
GET /api/platform/security/state?ucn=<10-digit-UCN>
Authorization: Bearer <platform-connector-token>
```

The response contains:

- `lockdown.active`
- the current Head Office lockdown instruction, where applicable
- the customer's approved security marker codes and CRM labels
- controlled branch instructions without confidential Head Office reasoning
- the authoritative access decision
- pending platform security commands
- the governance and precedence rules

The connected website should retrieve this state at sign-in and before security-sensitive actions. It should also poll for platform commands at a reasonable interval while operational.

## Acknowledge security commands

Request:

```http
POST /api/platform/security/commands/<command-id>
Authorization: Bearer <platform-connector-token>
Content-Type: application/json

{
  "status": "acknowledged",
  "message": "Security lockdown page activated",
  "state": {
    "securityLockdown": true
  }
}
```

Use `status: "failed"` when the connected website could not apply the command. Failed acknowledgements must be investigated by Head Office.

## Security markers in website CRMs

A connected website's customer CRM should display:

- UCN
- marker reference, for example `SMR-ATO-2026-AB12CD34`
- marker code, for example `SMC-ATO`
- approved CRM label
- risk level
- marker status
- branch instruction
- review or expiry date where supplied

The connected website must not attempt to display or reconstruct the confidential Head Office reason. The API deliberately returns `confidentialReasonWithheld: true`.

A marker is not itself a universal block. The connected website must enforce the accompanying central access decision and any active restrictions.

## JA Group Services ID and UCN allocation

JA Group Services ID is the customer identity provider. During Microsoft Entra External ID synchronisation, each recognised new customer identity is linked to an existing central customer where safely possible or assigned a new central customer record and 10-digit UCN.

The UCN is generated only by Head Office. Connected websites must not generate their own UCNs.

## Resend welcome notifications

Configure these encrypted Cloudflare environment values for production and preview separately:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

The sender address must belong to a domain verified in Resend.

After a successful JA Group Services ID synchronisation, the portal processes pending welcome notifications. The email includes the customer's UCN and explains its purpose. Delivery attempts are idempotent and recorded in `customer_notification_deliveries`.

Staff can inspect or retry pending welcome notifications through:

- `GET /api/customer-directory/notifications`
- `POST /api/customer-directory/notifications`

## Stripe configuration

Configure these encrypted Cloudflare environment values:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY` — optional for this internal portal

Do not expose `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` in browser code.

Create a Stripe webhook destination using this production endpoint:

```text
https://customerops.jagroupservices.co.uk/api/webhooks/stripe
```

Select these events:

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

Copy the signing secret for that exact destination into `STRIPE_WEBHOOK_SECRET`. Test-mode and live-mode destinations have different secrets and must not be mixed.

## Linking Stripe activity to a UCN

Where JA Group Services creates a Stripe Customer, Checkout Session, PaymentIntent or Subscription, add metadata:

```json
{
  "ucn": "1234567890",
  "platformCode": "PLANYX"
}
```

The webhook processor attempts linkage in this order:

1. UCN in Stripe metadata or Checkout `client_reference_id`.
2. Existing Stripe Customer link.
3. A unique verified-email match.

Unlinked Stripe records remain visible for operational reconciliation and must be reviewed rather than guessed.

## Stripe records retained by Head Office

The portal normalises:

- payments, charges and invoices
- Checkout orders
- subscriptions
- webhook processing status and errors

Relevant payment and dispute events also continue into the existing fraud and risk engine.

## Database migration and deployment

Apply all D1 migrations, including `0010_security_operations_control_plane.sql`, before relying on the new controls in production.

After deployment, complete these checks:

1. Open the Security Operations Centre and confirm the connected-system count.
2. Test the Stripe API connection.
3. Send a signed Stripe test event and confirm it appears in Stripe Control & Webhooks.
4. Run a JA Group Services ID delta sync and confirm a new customer receives one UCN welcome email.
5. Confirm a test security marker appears in the connected website CRM with its marker code and reference.
6. In a non-production test system, initiate and lift a manual lockdown and confirm the site's own maintenance setting remains unchanged.
