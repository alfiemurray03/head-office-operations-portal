# Head Office Operations Interface Standard

## Status

This is the mandatory interface standard for the JA Group Services Ltd Head Office Operations & Security Portal.

It exists to stop page-by-page visual improvisation. New screens and changes must use the page types and component rules below unless a documented user need requires an exception.

## Product model

The portal is an internal enterprise operations product. It is not a marketing dashboard, a consumer application or a collection of independent widgets.

The interface follows patterns used by mature security, identity and customer-operations products:

- a stable left-hand application navigation;
- a restrained utility header with global search and staff account controls;
- a small operational overview;
- queue-first work areas;
- dedicated record and investigation workspaces;
- contextual information beside the primary task;
- form-led administration pages;
- consistent permissions, audit and decision controls.

## Approved page types

### 1. Operational overview

Use for the Head Office control room only.

Structure:

1. page title and purpose;
2. one restrained status or metric strip;
3. priority work queue;
4. immediate actions or incidents;
5. recent operational activity.

Do not create a wall of cards or repeat the same metric in several sections.

### 2. Queue

Use for incidents, cases, customers, complaints, payments, audit events, markers and operational work.

Structure:

1. page header;
2. search, filters and saved-view controls;
3. one primary data table;
4. optional side context or secondary queue only where the relationship is necessary.

Tables are operational work surfaces. Columns must support comparison, triage or action. They must not be used to lay out ordinary page content.

### 3. Record workspace

Use for a customer, case, incident, staff member, platform or investigation.

Structure:

1. record identity, status and primary action;
2. key facts in a summary list;
3. major content families in tabs;
4. chronological activity in a timeline;
5. related context in a side panel or drawer.

Do not stack unrelated cards down the page.

### 4. Administration form

Use for settings, integrations, deployments, permissions and controlled configuration.

Structure:

1. page header;
2. short explanatory text or message bar;
3. labelled form sections separated by rules;
4. helper text beside the relevant field;
5. one primary save or confirm action.

Settings pages must not look like dashboards.

### 5. Reference page

Use for security taxonomies, controlled definitions and procedural guidance.

Structure:

1. clear page header;
2. contents or tabs where needed;
3. structured lists and headings;
4. no dashboard metrics unless they describe live operational state.

## Component rules

### Cards

Cards are permitted only for:

- a small number of overview metrics;
- onboarding or setup tasks;
- genuinely independent objects that can stand alone.

Cards are not the default wrapper for sections, fields, warnings, actions or key facts.

### Tables

Use tables only for:

- queues;
- registers;
- audit histories;
- memberships and assignments;
- comparable records.

Table headers use sentence case. Rows are compact and scannable. Actions are placed consistently at the end of a row.

### Summary lists

Use summary lists for key facts such as:

- status;
- owner;
- workflow;
- minimum age;
- last updated;
- decision source;
- customer or staff identifiers.

### Tabs

Use tabs for major content families that belong to one record or workflow. Examples:

- Overview;
- Security;
- Activity;
- Access;
- Linked services;
- Audit.

Do not use tabs for a single short section or as a substitute for clear navigation.

### Message bars

Use message bars for page-level or section-level state. Avoid multiple competing warning boxes.

### Buttons

A page or form has one primary action. Other actions are secondary, quiet or placed in an overflow menu. Destructive actions must be clearly distinguished and confirmed.

### Drawers and side sheets

Use a right-hand drawer for contextual details, review actions and short controlled forms that should not remove the operator from the current queue.

## Visual rules

- Use spacing, typography and separators before adding containers.
- Avoid decorative shadows, gradients and large rounded corners in operational screens.
- Use colour to communicate state, not to decorate sections.
- Use sentence case for headings, labels, buttons and table headers.
- Keep the main operational object visually dominant.
- Keep confidential evidence and internal reasoning in Head Office record views, not connected-site summaries.
- Maintain visible keyboard focus, sufficient contrast and usable responsive layouts.

## Change control

A pull request that introduces a new page or materially changes an existing page must identify its approved page type.

Reviewers should reject changes that:

- introduce a new ungoverned layout pattern;
- use tables for page layout;
- wrap every section in a card;
- add multiple equal-weight primary actions;
- duplicate navigation or status information;
- make the primary queue or record harder to scan.
