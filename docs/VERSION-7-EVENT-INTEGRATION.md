# Version 7 Event Integration Contract

## Endpoint

Connected divisions and approved services submit telemetry to:

`POST /api/v1/platform/events`

The platform credential must include the `events:write` scope.

## Authentication

Use the connector key as a bearer token:

```http
Authorization: Bearer ho_live_...
Content-Type: application/json
```

Connector keys must be stored as secrets. They must not be committed to source code, written to ordinary logs or sent through email.

## Required payload

```json
{
  "eventType": "payment.failed",
  "externalEventId": "provider-event-unique-id",
  "occurredAt": "2026-07-28T12:00:00.000Z"
}
```

## Recommended payload

```json
{
  "eventType": "payment.failed",
  "externalEventId": "evt_123",
  "dedupeKey": "stripe:evt_123",
  "occurredAt": "2026-07-28T12:00:00.000Z",
  "customerNumber": "1234567890",
  "amountMinor": 5999,
  "currency": "GBP",
  "countryCode": "GB",
  "ipHash": "sha256:...",
  "deviceHash": "sha256:...",
  "paymentFingerprintHash": "sha256:...",
  "attributes": {
    "newDevice": true,
    "provider": "Stripe",
    "paymentMethodType": "card"
  }
}
```

## Data minimisation

Submit only data required for detection and investigation. Use salted or keyed hashes for IP, device and payment-method correlation where possible. Do not submit:

- full card numbers;
- card security codes;
- passwords;
- raw identity-document images;
- session cookies;
- access tokens;
- payment-provider secret keys; or
- unrestricted free-text payloads copied directly from providers.

## Event naming

Use lowercase namespaced event types:

`domain.action_or_outcome`

Examples:

- `auth.failed`
- `auth.succeeded`
- `identity.verification_failed`
- `account.takeover_suspected`
- `payment.failed`
- `payment.succeeded`
- `refund.requested`
- `payment.dispute_opened`
- `chargeback.created`
- `data.unauthorised_access`
- `data.loss_reported`
- `system.ransomware_detected`

## Delivery rules

1. Generate a stable `externalEventId` at the source.
2. Retry failed deliveries using exponential backoff.
3. Reuse the same deduplication key for retries.
4. Treat HTTP `200` as an already processed duplicate.
5. Treat HTTP `202` as accepted and processed by the risk engine.
6. Treat HTTP `4xx` as a payload or authorisation problem requiring correction.
7. Treat HTTP `5xx` as temporary and retryable.
8. Do not block the customer-facing transaction while waiting for Head Office unless an existing enforcement instruction requires it.

## Security-control lookup

Before sensitive customer actions, connected divisions should call the existing scoped security endpoint and obey the returned enforcement actions. Confidential marker reasons remain within Head Office.

Sensitive actions include:

- sign-in after suspicious activity;
- email, telephone or identity changes;
- password or authentication recovery;
- payment initiation;
- refund processing;
- account closure;
- personal-data export; and
- deletion requests subject to a legal or security hold.

## Provider adapters

Each provider must have an adapter that:

1. verifies the provider webhook signature before parsing or trusting the event;
2. maps provider-specific event names to the Version 7 contract;
3. removes secrets and unnecessary personal data;
4. creates the stable deduplication key;
5. converts money to integer minor units;
6. hashes correlation identifiers using an approved secret or salt;
7. records delivery status; and
8. sends the normalised event through the scoped platform API.

## Initial integration order

1. Stripe payment, refund and dispute webhooks.
2. Planyx sign-in, account recovery, profile and payment events.
3. Profile Centre sign-in, profile change and export events.
4. Microsoft Entra risky sign-in or identity-protection signals where licensing and APIs permit.
5. Cloudflare security and application events where available.
6. Manual staff reports and imported historic incidents.

## Testing

Every adapter must be tested for:

- valid delivery;
- invalid signature rejection;
- duplicate delivery;
- out-of-order delivery;
- missing customer mapping;
- malformed money values;
- replayed events;
- excessive payload size;
- provider timeout; and
- protection against secret or card-data leakage.
