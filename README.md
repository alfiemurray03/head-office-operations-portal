# JA Group Services Head Office Operations Centre

The internal Head Office system for controlled customer operations across JA Group Services Ltd and its connected divisions and platforms.

The Centre is designed to hold the authoritative company-wide customer record, coordinate operational cases, issue enforceable security instructions, record communications and payment references, manage approvals, and preserve an append-only audit history.

## Production endpoints

- Operations Centre: [https://customerops.jagroupservices.co.uk/](https://customerops.jagroupservices.co.uk/)
- Health and readiness: [https://customerops.jagroupservices.co.uk/api/health](https://customerops.jagroupservices.co.uk/api/health)

The Operations Centre is restricted to authorised staff. The health endpoint exposes only service readiness, deployment revision and database/schema status.

## Production scope

The production system includes:

- Microsoft Entra staff authentication;
- server-side role and permission enforcement;
- a Universal Customer Register with unique ten-digit customer numbers;
- Head Office cases with sequential references, priorities, assignments and due dates;
- restricted data protection and safeguarding queues;
- confidential security markers and enforceable customer restrictions;
- company-wide customer communication history;
- payment and refund references;
- formal approval controls, including self-approval protection;
- connected-platform registration and scoped API credentials;
- staff role administration;
- governed operational settings;
- an append-only audit history; and
- a production health and readiness endpoint at `/api/health`.

No fictional customer records are shipped in the source.

## Architecture

- **Hosting:** Cloudflare Pages
- **Server runtime:** Cloudflare Pages Functions
- **Database:** Cloudflare D1, bound as `DB`
- **Authentication:** Microsoft Entra OpenID Connect
- **Production branch:** `main`
- **Build output:** `public`

The browser interface is split into cache-busted production modules under `public/js`. All controlled writes are validated and authorised again in Pages Functions; hiding a button in the browser is not treated as an access control.

## Security model

The system applies the following baseline controls:

- Microsoft identity-token validation against the JA Group Services tenant and application;
- host-only secure staff session cookies, with a browser-session fallback for restricted storage environments;
- server-side roles and granular permissions;
- same-origin checks for staff write requests;
- bounded JSON request bodies;
- one-way hashing of platform API credentials;
- one-time display of newly generated platform secrets;
- restricted DPO and safeguarding records;
- confidential marker reasons retained in Head Office;
- platform security responses limited to enforceable actions rather than confidential reasons;
- append-only audit events protected by database triggers;
- `no-store`, framing, referrer, permissions and indexing restrictions on responses; and
- request IDs for operational investigation.

## Data and schema

The `migrations` directory contains the D1 schema and production operational migration.

The production health endpoint also verifies the D1 binding and idempotently initialises the current operational catalogue and indexes. It returns `operational` only when both the database and production operations schema are ready.

Apply all numbered migrations when creating a new environment. Do not point a development or preview deployment at the production D1 database.

## Local development

```bash
npm ci
npm run dev
```

Open the address displayed by Wrangler.

Run the Pages Functions build check with:

```bash
npm run check
```

## Cloudflare deployment

Connect this repository to Cloudflare Pages using:

- Production branch: `main`
- Build command: `exit 0`
- Build output directory: `public`
- D1 binding: `DB`

Configure the Microsoft client secret and session secret as encrypted Cloudflare environment secrets. Never commit credentials, platform keys or staff session tokens.

## Change control

Production changes should be developed on a separate branch, validated, and then fast-forwarded to `main`. The repository validation workflow builds the Pages Functions for every pull request and production push.

Any change affecting authentication, permissions, security markers, restrictions, safeguarding, data protection, approvals or audit evidence requires explicit security review before release.

## Operational status

The Centre is an internal operational system. It is not a public customer portal and must not be used as a substitute for professional legal, safeguarding, fraud or regulatory judgement. Access must remain limited to authorised JA Group Services staff with a genuine business need.
