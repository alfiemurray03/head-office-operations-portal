# Principal PIN and customer-notice deployment

## Production boundary

This release adds a personal four-digit PIN after Microsoft Entra authentication for each authorised Head Office principal. Alfie and Jack configure and use separate PINs. The PIN is not a Cloudflare variable and is never stored in readable form.

Cloudflare requires one separate encrypted infrastructure secret:

- Project: `head-office-operations-portal`
- Environment: Production
- Secret name: `PORTAL_PIN_PEPPER`
- Secret value: a random high-entropy value of at least 32 bytes

Do not commit the pepper, show it in the portal, reuse it as a PIN or copy it to the four connected website projects.

## Required deployment order

1. Review and approve the exact release commit.
2. In Cloudflare Pages, add the encrypted production secret `PORTAL_PIN_PEPPER`.
3. Record the current D1 Time Travel bookmark or recovery point for `head_office_customer_operations_portal`.
4. Apply `migrations/0026_principal_pin_and_customer_notices.sql` to the production database.
5. Confirm migration `0026` appears in `d1_migrations`.
6. Confirm these tables exist:
   - `principal_pin_credentials`
   - `principal_pin_events`
   - `customer_notices`
   - `customer_notice_receipts`
7. Confirm `portal_sessions.pin_verified_at` exists.
8. Confirm both authorised principals and existing portal sessions remain present.
9. Run `PRAGMA foreign_key_check;` and require no rows.
10. Deploy the exact reviewed Pages commit.
11. Alfie signs in with Microsoft and creates his own four-digit PIN.
12. Jack signs in separately and creates his own four-digit PIN.
13. Confirm five incorrect attempts cause a 15-minute lockout.

Do not deploy the PIN-gated Pages code before the secret and migration are present. The code deliberately fails closed when `PORTAL_PIN_PEPPER` is absent.

## Customer notices

Connected websites use their own existing `CUSTOMEROPS_API_KEY` as a server-side bearer credential. Each key must be registered by Head Office and include:

- `support:read`
- `support:write`

The clear key remains only in that website's encrypted Cloudflare production secret. A browser must never receive or submit it.

Server-side website routes call:

- `GET /api/platform/customer-notices?platformCustomerId=<website-account-id>`
- `POST /api/platform/customer-notices` with `platformCustomerId`, `noticeId`, and action `read` or `dismiss`

A random string created outside Head Office is not a valid `CUSTOMEROPS_API_KEY`, because Head Office stores and checks the key's SHA-256 hash in `platform_api_credentials`. Generate each key through the governed Website Customer Service Controls screen and copy it once into the matching Cloudflare project.

## Rollback

If deployment fails before customers or principals use the new functions, roll back the Pages deployment to the previous reviewed commit. Do not manually delete the new D1 tables. If database restoration is required, use the recorded D1 Time Travel point and follow the controlled production-restoration procedure.
