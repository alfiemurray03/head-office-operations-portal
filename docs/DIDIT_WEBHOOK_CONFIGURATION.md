# Didit webhook configuration

## Production destination

- **Name:** JA Group Services CustomerOps
- **Webhook version:** v3.0
- **Webhook URL:** `https://customerops.jagroupservices.co.uk/api/webhooks/didit`
- **Subscribed event:** `status.updated`

## Required Cloudflare secrets and configuration

Store the Didit credentials in the CustomerOps Cloudflare Pages project, never in GitHub or browser code:

- `DIDIT_API_KEY` — encrypted secret used only by server-side Didit API requests;
- `DIDIT_WEBHOOK_SECRET` — encrypted signing secret for the production webhook destination;
- `DIDIT_WORKFLOW_ID` — identity, fraud and account-recovery workflow configuration;
- `DIDIT_AGE_WORKFLOW_ID` — separate age-verification workflow configuration.

The workflow identifiers are configuration values rather than credentials, but keeping them in Cloudflare configuration allows workflow changes without exposing provider details to the browser.

Do not put API keys or webhook signing secrets in GitHub, browser code, email, tickets, screenshots or chat messages.

## Mandatory rotation after exposure

If a Didit API key or webhook signing secret is pasted into a chat, document, ticket or other uncontrolled location:

1. rotate or replace it in the Didit Business Console immediately;
2. replace the matching encrypted Cloudflare Pages secret;
3. redeploy CustomerOps;
4. run the governed Didit API and webhook readiness tests;
5. confirm a newly signed test delivery is accepted before retiring the incident record.

The former value must be treated as compromised even when the repository itself never contained it.

## Endpoint security

The endpoint:

- reads the raw body before JSON processing;
- requires `X-Signature-V2`;
- verifies HMAC-SHA256 against recursively sorted, Unicode-preserved canonical JSON;
- requires `X-Timestamp` within five minutes;
- rejects body/header timestamp mismatches;
- stores an idempotent event record before processing;
- fingerprints the payload without storing raw identity evidence;
- returns 5xx on processing failure so Didit retries;
- records matched verification status against the Universal Customer Register;
- lifts only a linked active `REQUIRE_ENHANCED_VERIFICATION` restriction after an Approved signed webhook result;
- records a central risk signal after a Declined result.

A manual status refresh may update the displayed provider status, but it must not lift a Head Office access requirement. Cancelling a verification request also does not remove a linked restriction; that requires a separate authorised Head Office decision. Creating a replacement link creates a new tracked Didit session and automatically sends the invitation to the verified customer email address.

## Public readiness check

A `GET` or `HEAD` request to the webhook URL returns a non-sensitive readiness response. POST deliveries are rejected with `503 DIDIT_WEBHOOK_NOT_CONFIGURED` until the encrypted webhook secret has been configured.
