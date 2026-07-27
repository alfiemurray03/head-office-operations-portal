# JA Group Services Head Office Operations Portal

The central internal system for universal customer records, Head Office cases,
security controls, complaints, refunds, platform oversight and governance across
JA Group Services Ltd and its connected platforms.

## Version 1

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
- a Worker health endpoint and baseline security headers.

The records shown in the preview interface are fictional demonstration data.
No live customer, Microsoft, Stripe or website data is connected.

Preview sign-in:

- Username: `admin`
- Password: `PreviewOnly!2026`

This browser-side preview login is a usability gate only. It is deliberately not
represented as production authentication and must never protect live data.

## Local development

```bash
npm install
npm run dev
```

Open the local address displayed by Wrangler. The health endpoint is available
at `/api/health`.

## Cloudflare deployment

Connect this private GitHub repository to Cloudflare Workers Builds.

- Production branch: `main`
- Build command: `npm run deploy`
- Deploy command: leave blank when the build command performs the deployment

Cloudflare Access must be placed in front of the Worker before any real staff or
customer data is introduced.

## Data layer

`migrations/0001_initial_schema.sql` contains the initial D1 schema. A D1
database binding will be added after the Cloudflare account resources and
environment separation are confirmed.

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
