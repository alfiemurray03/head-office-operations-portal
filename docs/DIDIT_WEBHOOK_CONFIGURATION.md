# Didit webhook configuration

## Production destination

- **Name:** JA Group Services CustomerOps
- **Webhook version:** v3.0
- **Webhook URL:** `https://customerops.jagroupservices.co.uk/api/webhooks/didit`
- **Subscribed event:** `status.updated`

## Required Cloudflare secret

After the Didit destination is created, store the destination's webhook secret in the CustomerOps Cloudflare Pages project as an encrypted secret named:

`DIDIT_WEBHOOK_SECRET`

Do not put the secret in GitHub, browser code, email, tickets or screenshots.

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
- lifts only a linked active `REQUIRE_ENHANCED_VERIFICATION` restriction after an Approved result;
- records a central risk signal after a Declined result.

## Public readiness check

A `GET` or `HEAD` request to the webhook URL returns a non-sensitive readiness response. POST deliveries are rejected with `503 DIDIT_WEBHOOK_NOT_CONFIGURED` until the encrypted webhook secret has been configured.
