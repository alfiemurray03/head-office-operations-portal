# Automated Customer Operations

## Operating principle

JA Group Services Ltd Head Office is the operational customer master record. Customer identities and activity arrive automatically from trusted systems. Staff use the portal for exceptions, reviews, decisions and controlled actions rather than routine customer data entry.

## Automatic customer flow

1. A customer registers or signs in through a connected JA service using Microsoft Entra External ID.
2. The service validates the Microsoft token server-side.
3. The service calls `POST /api/platform/customers/upsert` using its scoped Head Office connector key.
4. Head Office matches the person by the connected-service account, Microsoft tenant/object ID, existing external identity, then verified email under conflict controls.
5. Head Office creates or updates the universal customer record and returns the ten-digit customer number and active enforcement controls.
6. The connected service stores the universal customer number and includes it in future payment, complaint, security and operational events.

## Required platform credential

The connected system requires the `customers:write` scope. The credential must remain in server-side secrets and must never be exposed to browser JavaScript.

## Customer upsert request

```http
POST /api/platform/customers/upsert
Authorization: Bearer <PLATFORM_CONNECTOR_KEY>
Content-Type: application/json
```

```json
{
  "entraTenantId": "external-tenant-guid",
  "entraObjectId": "customer-object-guid",
  "platformCustomerId": "planyx-user-123",
  "displayName": "Sarah Jones",
  "givenName": "Sarah",
  "surname": "Jones",
  "email": "sarah@example.com",
  "userPrincipalName": "sarah@example.com",
  "accountEnabled": true,
  "accountStatus": "active",
  "createdAt": "2026-07-28T15:00:00Z"
}
```

## Successful response

```json
{
  "customer": {
    "id": "internal-record-id",
    "customerNumber": "1000000001",
    "displayName": "Sarah Jones",
    "accountStatus": "active",
    "securityStatus": "clear"
  },
  "created": true,
  "matchedBy": "new",
  "enforcement": {
    "action": "allow",
    "restrictions": []
  }
}
```

A `409 CUSTOMER_IDENTITY_REVIEW_REQUIRED` response means the service must not create a second local Head Office customer. The matter goes to the Head Office identity review queue.

## Scheduled Microsoft reconciliation

The repository includes a separate Cloudflare Worker configured in `wrangler.customer-directory.jsonc`. It runs hourly and calls the protected Head Office reconciliation endpoint.

The same randomly generated `AUTOMATION_SECRET` must be configured as an encrypted secret in:

- the Head Office Pages project; and
- the `head-office-customer-directory-automation` Worker.

Deploy the Worker with:

```bash
npx wrangler secret put AUTOMATION_SECRET --config wrangler.customer-directory.jsonc
npx wrangler deploy --config wrangler.customer-directory.jsonc
```

The Pages project must also contain `AUTOMATION_SECRET` as an encrypted production secret before the Worker is activated.

## Staff workflow

Staff do not type customer details into cases, complaints, refunds, disputes, communications or security reports. They search the universal register and select the existing record. Head Office then links the current identity, connected services, payments, restrictions, cases and audit evidence automatically.

Staff intervention is reserved for:

- uncertain identity matches;
- suspected fraud;
- security alerts and enforcement decisions;
- complaints and redress decisions;
- refund and dispute approvals;
- personal-data breach assessments;
- safeguarding matters;
- exceptional corrections supported by evidence.
