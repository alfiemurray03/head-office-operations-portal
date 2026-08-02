# Head Office Customer Service Centre deployment

## Status

This release makes the Head Office Customer Service Centre the authoritative customer-service system for:

- JA Group Services corporate website;
- Planyx;
- Profile Centre; and
- JA Domain Hub.

The public websites use same-origin server bridges. Platform API credentials remain server-side and are never returned to browsers.

## Operating model

- **JA Group Services, Profile Centre and JA Domain Hub:** human-first. Customer messages enter the Head Office queue and receive a server-generated acknowledgement.
- **Planyx:** the existing server-side Planyx support assistant may continue while the conversation is in AI or hybrid mode. A separate `support:ai` scope is required before Planyx can record an assistant message centrally.
- **Restricted categories:** data protection, safeguarding and security are placed into human-only handling.
- **Complaints and material escalations:** may be converted into formal Head Office cases with the transcript preserved.

## Production order

1. Deploy the Head Office Operations Centre from `main`.
2. Confirm the D1 binding is named `DB` and the health endpoint is operational.
3. Deploy each website from its `main` branch.
4. Confirm each website has its existing `CUSTOMEROPS_API_KEY` secret and that `CUSTOMEROPS_BASE_URL`, where set, points to `https://customerops.jagroupservices.co.uk`.
5. Leave `HEAD_OFFICE_SUPPORT_CENTRE_ENABLED` unset or set it to `true`. Setting it to `false` acts as an emergency website-level stop.
6. Open the Customer Service Centre in Head Office and confirm the four website branches appear.
7. Send one controlled test message from each website and verify receipt, acknowledgement, adviser takeover and reply.

## Credential scopes

On first authenticated support access, the central service adds the minimum support scopes to active credentials belonging to the four approved platforms:

- `support:read`;
- `support:write`; and
- `support:ai` for Planyx only.

The credential remains restricted to its own platform record. Other connected systems are not automatically activated.

## Data protection and retention

- Public support messages are stored in the central D1 database.
- Internal and Head Office-only notes are not returned to customer websites.
- Confidential marker reasons, passwords, tokens, cookies and credential material are removed from supplied metadata.
- Restricted-category access remains subject to server-side staff authority.
- The initial conversation retention setting is **180 days** and can be changed by authorised Head Office configuration.
- Formal cases, complaints, safeguarding records and data protection records must follow the Company’s applicable retention schedule rather than being deleted solely because a chat retention period expires.
- Access, replies, notes, takeover and material configuration changes are audited.

## Rollback and emergency stop

A database-destructive rollback must not be used.

For a website-level emergency stop:

1. set `HEAD_OFFICE_SUPPORT_CENTRE_ENABLED=false` for the affected website; or
2. disable the website branch from the Head Office Customer Service Centre.

For a central emergency stop:

1. disable connected systems or the relevant branch in Head Office;
2. revoke the affected platform credential where compromise is suspected;
3. preserve conversations and audit records for investigation; and
4. revert the application commit only after preserving evidence and confirming database compatibility.

The support tables are additive. Rolling back application code does not require dropping them.

## Acceptance checks

- customer widget is hidden when no valid server credential exists;
- browser cannot submit a system message;
- an assistant message requires `support:ai`;
- customer messages create or update a central conversation;
- human-first branches receive an acknowledgement;
- Head Office staff can take over and reply;
- customer websites receive only customer-visible messages;
- data protection, safeguarding and security conversations remain restricted;
- closing and reopening conversations is audited; and
- no Tawk.to or Atlassian/Jira customer-service dependency remains.
