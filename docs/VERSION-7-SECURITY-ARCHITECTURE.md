# Head Office Operations Centre — Version 7 Security Architecture

## 1. Purpose

Version 7 is the central JA Group Services Head Office control system for customer operations, fraud and security intelligence, cyber incidents, personal-data breach assessment, complaints, refunds, payment disputes and cross-division operational work.

The system is designed to support evidence-based decisions. It does not claim to prevent all fraud or security incidents, and it must not replace professional legal, regulatory, safeguarding, cyber-security or financial judgement.

## 2. Assurance basis

The design is aligned to the following control approaches:

- NIST Cybersecurity Framework 2.0: Govern, Identify, Protect, Detect, Respond and Recover;
- NIST SP 800-61 Rev. 3 incident-response integration;
- NCSC Cyber Assessment Framework outcome-based assurance;
- NCSC incident severity assessment using confidentiality, integrity, availability, scale and consequences;
- ICO accountability, security and personal-data breach requirements;
- OWASP application-security verification principles;
- CIS Controls implementation practices; and
- PCI DSS v4.0.1 boundaries for payment-account data.

Alignment is not certification. JA Group Services Ltd must not describe Version 7 as certified to a standard unless the relevant independent certification or validation has been completed.

## 3. Security dimensions

Version 7 separates six concepts that must never be collapsed into one generic security level.

| Dimension | Codes | Purpose |
|---|---|---|
| Customer/event risk | R0–R4 | Assessed likelihood and potential harm |
| Enforcement | A0–A5 | Proportionate action permitted or recommended |
| Data classification | D0–D4 | Sensitivity and handling requirements |
| Staff authority | P0–P5 | Authority to access, process, decide or administer |
| Case confidentiality | K0–K3 | Need-to-know and sealed-record boundaries |
| Incident severity | SEV-1–SEV-4 | Operational urgency and response governance |

A high risk does not automatically require a full account freeze. The event may require step-up verification, manual approval or a targeted restriction instead. Human decisions must be recorded with reasons and evidence.

## 4. Event and risk model

Approved sources submit namespaced events such as:

- `auth.failed`;
- `auth.succeeded`;
- `identity.verification_failed`;
- `payment.failed`;
- `payment.succeeded`;
- `refund.requested`;
- `payment.dispute_opened`;
- `chargeback.created`;
- `account.takeover_suspected`;
- `data.unauthorised_access`;
- `data.exfiltration_suspected`;
- `data.loss_reported`; and
- `system.ransomware_detected`.

The engine de-duplicates events, evaluates versioned rules, records each matched signal, calculates a score, assigns security dimensions and creates an alert where the review threshold is met.

Critical events may automatically create an incident and a Head Office task. This is workflow automation, not an automatic finding of guilt, fraud or legal reportability.

## 5. Detection governance

Every detection rule must include:

- a unique code and version;
- the event type it evaluates;
- the rationale and score;
- the threshold and time window;
- the minimum risk level;
- the recommended enforcement level;
- incident severity;
- data classification;
- confidentiality level;
- an owner;
- a review date; and
- evidence of testing before production activation.

False positives must be recorded rather than deleted. Rule changes require audit evidence and should be tested against controlled scenarios before release.

## 6. Incident and breach response

Incidents move through:

`new → triage → contained → investigating → remediating → recovering → monitoring → closed`

Every incident has a timeline. A possible personal-data breach creates a breach assessment record and a 72-hour decision-support deadline from awareness. The DPO determines whether notification is required and records the legal rationale.

The system must retain records of all assessed personal-data breaches, including those not reported.

## 7. Payment boundary

Version 7 stores operational payment references, amounts, currency, provider identifiers and hashed risk identifiers. It must not store:

- full primary account numbers;
- card security codes;
- magnetic-stripe or equivalent sensitive authentication data;
- online banking credentials; or
- raw payment-provider secrets.

Hosted or redirected payment-provider flows should be preferred to reduce the cardholder-data environment. Connector secrets are displayed once and stored only as one-way hashes.

## 8. Access control

The server enforces permissions independently of the browser interface. Core roles include:

- System Administrator;
- Head Office Operations;
- Security Officer;
- Incident Manager;
- Fraud Operations;
- Complaints Manager;
- Branch Operator;
- Data Protection Officer; and
- Designated Safeguarding Officer.

Restricted records require specialist permissions. Future P-level enforcement must also consider the tenant, organisation unit, division, record type, data classification, action, monetary limit and time limit.

## 9. White-label readiness

The present build is a JA Group Services internal system. A commercial white-label release requires a multi-tenant redesign in which every record carries an immutable tenant identity derived from authentication, every query enforces tenant ownership and tenant isolation is tested independently.

Branding controls alone do not make the system multi-tenant or commercially safe.

## 10. Release gate

Version 7 must not be promoted to production unless:

1. the Cloudflare Pages Functions build passes;
2. the append-only database migration validates;
3. the health endpoint reports the database, operational schema and Version 7 schema as ready;
4. Microsoft sign-in and role loading pass;
5. event ingestion, duplicate handling, alert creation and incident creation pass controlled tests;
6. complaint, refund and dispute cases create their linked records and tasks;
7. DPO and safeguarding access boundaries are tested;
8. no payment-card data or secret appears in logs; and
9. a rollback point is recorded.
