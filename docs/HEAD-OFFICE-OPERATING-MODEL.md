# Head Office Operations Centre — Operating Model

## Single operating authority

The Head Office Operations Centre is one internal JA Group Services Ltd portal. It is operated only under the authority of **JA Group Services Ltd — Head Office**.

Staff do not switch into Planyx, Profile Centre, JA Domain Hub or any other division as a separate operating context.

## Divisions and services

Divisions and services may appear within records as:

- the originating service or division;
- the affected service or division;
- a case-routing destination;
- a reporting dimension;
- a connected system supplying security or operational events; or
- a system receiving an authorised Head Office instruction.

Their appearance within a record does not create a separate portal, staff login, security boundary or operating authority.

## Access

Access is restricted to authorised JA Group Services Ltd Head Office staff using the company Microsoft Entra environment. Connected services authenticate through scoped system credentials and do not receive interactive staff access to the Head Office portal.

## White-label future

Any future white-label or multi-tenant product must use a separate tenant-isolation architecture. The present internal portal must not simulate tenancy by treating internal divisions as separate operating contexts.
