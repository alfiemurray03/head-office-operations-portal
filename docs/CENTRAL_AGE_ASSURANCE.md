# Central Customer Age Assurance

## Purpose

The Head Office Operations & Security Portal is the sole decision authority for customer age assurance across connected JA Group Services websites.

Didit performs the hosted verification. Connected websites do not receive or store the Didit API key, webhook secret, identity document images or raw biometric evidence.

## Fixed account boundary

Age assurance applies only to records in the Universal Customer Register.

It does not query, change, block or otherwise affect:

- Staff Directory profiles;
- staff numbers;
- the JA Group Services Microsoft staff tenant;
- staff Microsoft sign-in; or
- Head Office staff portal sessions.

A person who is both a member of staff and a customer can still be subject to the policy when using their separate customer account and UCN. Their staff identity remains unaffected.

## Initial deployment state

The migrations deliberately install the service without starting enforcement:

| Control | Initial value |
| --- | --- |
| Group enforcement master switch | Off |
| Planyx deployment | Disabled |
| Planyx minimum customer age | 16 |
| Planyx Didit workflow | Not assigned |
| Planyx threshold validation | Not confirmed |
| Profile Centre deployment | Disabled |
| Profile Centre minimum customer age | 18 |
| Profile Centre Didit workflow | Not assigned |
| Profile Centre threshold validation | Not confirmed |
| Approved evidence validity | 365 days |

No customer access decision changes until the master switch, the relevant platform deployment, its threshold-specific workflow mapping and its validation control are all deliberately enabled or completed.

## Deployment states

- **Disabled:** no age requirement is applied by Head Office to that website.
- **Paused:** valid existing age evidence remains accepted; unverified customers remain unable to satisfy the requirement and no new Didit sessions can be created.
- **Enabled:** the configured threshold is enforced and an unverified customer receives a step-up decision.

## Head Office controls

Authorised staff can configure the service under **System Settings → Customer Age Assurance Deployments**.

The service exposes separate governed controls for Planyx and Profile Centre, including deployment state, minimum age, Didit workflow mapping, threshold-validation confirmation and evidence validity.

Planyx must use a workflow tested specifically for its 16+ threshold. Profile Centre must use a workflow tested specifically for its 18+ threshold. A shared workflow must not be used merely by changing the retained `required_age` value: that value records the threshold requested but does not prove the provider workflow actually tested it.

The threshold-validation switch must be set only after the mapped workflow has been tested against the relevant threshold. This prevents a workflow tested for 16+ from being assumed to establish 18+ eligibility.

## Connected website contract

Each website uses its existing Head Office platform credential. It never receives a Didit credential.

### Read deployment

`GET /api/platform/age-assurance/config`

The response includes the website deployment state, minimum age, workflow readiness state, whether enforcement has started and the fixed staff-account exclusion.

### Request a customer session

`POST /api/platform/age-assurance/session`

The request must identify the customer using a UCN or an already linked platform account and must include:

```json
{
  "customerNumber": "UCN-…",
  "consentAccepted": true,
  "consentVersion": "age-assurance-v1"
}
```

The endpoint refuses to create a session when:

- the group master switch is off;
- the website deployment is disabled;
- the deployment is paused;
- a threshold-specific workflow has not been assigned;
- the mapped threshold has not been validated;
- Didit is not configured; or
- customer disclosure/consent has not been recorded.

A successful response returns the hosted Didit verification URL and identifiers required by the connected website. The Didit API key remains server-side in Head Office, and the session uses only the workflow mapped to that connected website.

### Authoritative access check

Connected websites continue to use the central platform access-decision endpoint. The response includes `ageAssurance` and can return:

- `allow` when valid evidence satisfies the website threshold;
- `step_up` when a live deployment requires a new customer check; or
- `deny` where the requirement applies but a new session cannot safely be started.

An approved 18+ result can satisfy a 16+ service. A retained 16+ result cannot satisfy an 18+ service.

## Decision source

Only a valid, timestamp-fresh, signed Didit webhook can make a session approved for age-assurance evidence. Browser completion callbacks and redirect URLs are not authoritative.

Age-verification decline does not automatically create a fraud marker, and an age-verification approval cannot lift an unrelated enhanced identity-verification restriction.
