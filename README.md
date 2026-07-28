# JA Group Services Head Office Operations Portal

The central internal system for universal customer records, Head Office cases,
security controls, complaints, refunds, platform oversight and governance across
JA Group Services Ltd and its connected platforms.

## Current foundation

This is the first Cloudflare-ready preview build. It provides:

- a local preview username-and-password sign-in screen;
- a responsive internal operations dashboard;
- Universal Customer Register and customer search;
- universal customer record view;
- linked platform accounts;
- security markers and restrictions;
- case creation interface;
- Head Office module navigation;
- a D1 relational schema for customers, platforms, cases, staff roles and
  append-only audit events;
- a versioned platform connector API with one-time API-key generation;
- per-platform scopes and hashed credential storage;
- idempotent customer registration and platform-account linking;
- an enforceable security-controls endpoint;
- Pages Functions and baseline security headers.

The interface uses genuine D1 records and empty states. No fictional customer
records are shipped in the source.

Local authentication is verified by Pages Functions using Cloudflare secrets.
Microsoft Entra staff identity will replace it before production use.

## Local development

```bash
npm install
npm run dev
```

Open the local address displayed by Wrangler. The health endpoint is available
at `/api/health`.

## Cloudflare deployment

Connect the GitHub repository to Cloudflare Pages.

- Production branch: `main`
- Build command: `exit 0`
- Build output directory: `public`

Bind D1 as `DB`, then configure `LOCAL_ADMIN_USERNAME`,
`LOCAL_ADMIN_PASSWORD`, and `SESSION_SECRET` as encrypted environment secrets.

## Data layer

The `migrations` directory contains the D1 schema and platform API migration.
Apply migrations to each Cloudflare environment before using the portal.

## Security status

This preview is not authorised for production customer data. Production
readiness requires, at minimum:

1. Cloudflare Access with Microsoft staff authentication.
2. Server-side role and permission enforcement.
3. D1 production and staging databases.
4. Secret management and signed platform API requests.
5. R2 evidence storage with controlled retrieval.
6. Entra External ID and connected-platform integration.
7. Automated tests, security review and deployment approval controls.
