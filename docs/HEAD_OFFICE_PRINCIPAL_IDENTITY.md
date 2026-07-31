# Head Office principal identity and access model

## Access boundary

The Head Office Operations & Security Portal has one Portal role, `HEAD_OFFICE_PRINCIPAL`, held independently and equally by exactly two people:

- `HOP-USER-001` — Alfie Thomas Holywood Murray
- `HOP-USER-002` — Jack Nicolau Sousa Da Silva

The role grants `*` and includes future high-level Portal permissions. Both accounts display security level `HIGHEST`, access level `FULL`, and authority `Equal Principal`. Local website administrators, tenant users, developers and suppliers are not Portal principals. There is no local, shared or generic administrator login.

## Configuring immutable Microsoft identities

Migration `0021_head_office_principals.sql` creates both profiles in `pending_identity` state without guessing an Entra identifier. Configure the real immutable object IDs as Cloudflare secrets or encrypted deployment variables named `ALFIE_ENTRA_OBJECT_ID` and `JACK_ENTRA_OBJECT_ID`. Do not put either value in source control.

On authentication, the server synchronises a configured value to the matching `authorised_principals` row and activates that fixed profile. It then matches the token tenant ID and object ID against the active database register. Email is profile/contact data only and never an access key. A future principal cannot be added through the ordinary Portal UI; it requires a governed migration and a distinct two-person approval record.

## Authentication and sessions

Microsoft Entra uses OIDC authorisation code flow with PKCE, state, nonce, issuer, tenant, audience, lifetime and RS256 signature validation. The callback creates a new random 256-bit opaque session identifier after the principal check. Only its SHA-256 hash is stored in D1. The browser receives it in the host-only `__Host-ho_session` cookie with `Secure`, `HttpOnly`, `Path=/` and `SameSite=Lax`; no token is placed in a URL, JavaScript storage or API response.

Every protected API uses the shared session and permission middleware. It reloads the session, Portal user, authorised principal and role from D1, rejecting missing, expired, revoked, suspended or non-principal sessions. State-changing routes enforce same-origin requests. Suspending an account immediately makes existing sessions unusable; the suspension procedure should also revoke its active `portal_sessions` rows.

Users can sign out the current device or revoke any/all of their own sessions. Session ownership is derived from the authenticated session; request parameters cannot select another user.

## Profiles and preferences

Personal data is separated into `portal_users` and `portal_user_preferences`. Profile and preference endpoints never accept a target user ID. Dashboard data is validated JSON with a fixed widget allowlist, bounded pinned IDs and no HTML or executable content. Theme, density, masking, notification, accessibility, filters and dashboard preferences affect convenience only and never authorisation.

## Failures and audit

An authenticated but unregistered Microsoft identity receives HTTP 403 and no Portal session. Invalid OIDC transactions and identities outside the configured tenant are rejected before session creation. Authentication events record success, denial, revocation and sign-out without tokens or secrets.

Operational audit events receive the actual internal user ID, display name, immutable Entra reference, role, session ID and authentication strength from the server session. Actors cannot submit or edit those fields. Existing database triggers keep audit rows append-only.

## Two-person approvals

`principal_approval_requests` binds requester and approver to both internal user IDs and sessions. A check constraint and triggers reject self-approval, so two sessions for one person never represent two principals. Each request has an expiry, business reason and optional governance reference, and execution state is separate from approval state. Existing operational approvals also block self-approval regardless of wildcard authority.

## Deployment and acceptance

1. Apply D1 migration `0021_head_office_principals.sql`.
2. Configure both immutable object IDs securely in the production Cloudflare environment.
3. Preserve the existing OIDC client and audit secrets.
4. Deploy Pages Functions and static assets.
5. Validate Alfie and Jack independently in fresh/private browsers, including refresh, sign-out, profile isolation, preference isolation and session revocation.
6. Confirm a third tenant identity receives 403 and no protected API response.

Do not claim production authentication complete until both real identities reach the dashboard and remain authenticated after refresh.
