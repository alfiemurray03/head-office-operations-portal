# Connected Website Security Contract

## Authority model

JA Group Services Ltd Head Office is the sole authority for central customer security markers, restrictions, lockdown decisions and reusable age-assurance outcomes.

Planyx, Profile Centre and future connected services are enforcing branches. They may display branch-safe instructions and apply the returned access decision, but they must not create, clear, downgrade or override a central marker.

Confidential case reasoning, evidence, internal notes and sensitive fraud intelligence remain in Head Office.

## Authentication

Each connected service uses its own Head Office platform credential. Credentials must be stored only as encrypted server-side secrets and scoped to the minimum permissions required.

Typical scopes:

- `customers:write` for customer and UCN synchronisation;
- `security:read` for access decisions and branch-safe marker state;
- event scopes appropriate to the connected service.

The credential is never exposed to a browser, customer account, staff page source or client-side storage.

## Customer access decision

```http
POST /api/platform/access/decision
Authorization: Bearer <PLATFORM_CONNECTOR_KEY>
Content-Type: application/json
```

The request identifies the central customer using a UCN, linked platform account, or the connected customer Entra identity.

The response contains:

- `allow`, `deny`, `review` or `step_up`;
- whether existing customer sessions must be revoked;
- branch-safe restriction summaries;
- the versioned customer-only age-assurance deployment;
- no confidential restriction reason.

Planyx requires the age contract `ja-head-office-age-assurance-v1`, deployment key `PLANYX`, minimum age `16`, customer-only scope and permanent staff exclusion. A missing or mismatched contract fails closed.

Profile Centre will use the same contract with deployment key `PROFILE_CENTRE` and minimum age `18` when its connector is installed.

## Branch-safe security state

```http
GET /api/platform/security/state?ucn=1000000001
Authorization: Bearer <PLATFORM_CONNECTOR_KEY>
```

Contract version: `ja-head-office-security-state-v1`.

The response may include:

- the platform security/lockdown state;
- the current customer access decision;
- active branch-visible marker references, labels, risk levels and instructions;
- branch-safe restrictions;
- pending security commands;
- the generation timestamp.

The response explicitly states that confidential reasoning is withheld.

## Planyx administration

Planyx reads the security-state endpoint server-side and displays the result in the customer CRM Security tab. The UI shows the UCN, central access decision, security status, branch-visible markers, age-assurance state and any platform lockdown instruction.

A last-known branch-safe response may be cached in Planyx for degraded read-only visibility. Cached data is labelled and cannot be treated as authority to lift a restriction or grant access.

## Profile Centre readiness

Profile Centre can use the same endpoints without changing the Head Office decision model. Its implementation must:

1. register a distinct platform identity and credential;
2. synchronise each customer and retain the UCN;
3. call the central access decision before releasing a customer session;
4. display branch-safe marker state in its admin customer record;
5. enforce the 18+ deployment only after Head Office deliberately enables it;
6. keep staff/admin authentication outside all customer age and UCN controls.

## Staff boundary

These endpoints are customer-only. Staff Directory profiles, staff numbers, Microsoft staff sign-in, portal role assignments and staff sessions are never treated as customer records and are never subject to customer age assurance.
