# Profile Centre platform onboarding

Profile Centre is registered as the distinct Head Office platform
`PROFILE_CENTRE` for division `DIV-020`. It is not an alias of Planyx.

The production connector uses:

- `POST /api/platform/customers/upsert` for verified customer identity linkage and UCN assignment;
- `POST /api/platform/access/decision` before Profile Centre creates or continues a customer session;
- `GET /api/platform/security/state?ucn=…` for branch-safe administrative visibility;
- `GET /api/platform/commands` and command acknowledgement endpoints for idempotent enforcement;
- `POST /api/platform/events` for approved operational events;
- `GET /api/platform/age-assurance/config` under contract `ja-head-office-age-assurance-v1`.

The credential must be dedicated to Profile Centre and limited to
`customers:write`, `security:read`, and `events:write`. Head Office stores only
its SHA-256 hash. Profile Centre stores the clear credential only as an encrypted
Cloudflare Pages production secret.

Head Office remains authoritative for UCNs, restrictions, access decisions,
session revocation, security state, and reusable age assurance. The branch
receives instructions and summaries only; confidential case reasoning is never
included. Age assurance is configured for Profile Centre customers aged 18 or
over, excludes staff identities, and remains disabled until an authorised Head
Office operator enables enforcement.
