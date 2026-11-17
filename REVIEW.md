# CPMS online review — 17 November 2026

This snapshot represents the application source of the running release
`campaign-quick-sheet-20261113-d24e422`, inspected on 17 November 2026.
Its internal source checkpoint is `f67b46550274db420e6287993dfdea4c105a16aa`.
The checkpoint differs from the deployed tree only in two release-documentation
files; all application code, migrations and build configuration were compared
using SHA-256 with CRLF/LF normalization. No deployment was performed for this
publication.

## Review scope

The code now includes real-data read-only Guest projections, Campaign link
sharing with audience/tab permissions, export of Public Campaign tabs to a
managed Google Sheet, AI answer Markdown rendering, and mission/Paper Plane
rewards. Review the complete application, including existing Planning,
Contracts, Bookings, Materials and shared grid behavior.

Useful entry points:

- `apps/api/src/modules/public-guest/`: projections, Campaign sharing and Sheet export.
- `apps/api/src/modules/auth/`: anonymous route allowlists and authenticated boundaries.
- `apps/api/src/modules/campaign-workflow/`: Campaign commands and authorization.
- `apps/api/src/modules/google-integration/`: provider operations and credentials handling.
- `apps/api/src/modules/engagement/`: reward eligibility, idempotency and persistence.
- `apps/web/src/guest-preview-app.tsx`, `pages/shared-campaign-page.tsx` and
  `components/campaign-sharing-dialog.tsx`: public and shared UI.
- `apps/web/src/components/ai-message.tsx`: safe Markdown/link rendering.
- `apps/web/src/components/supply-grid.tsx` and associated grid/save helpers:
  private drafts, navigation, editing and shared consumers.
- `database/schema.prisma`, `database/migrations/` and the colocated tests:
  persistence and regression evidence.

Preserve specialist workflows, application-service boundaries, existing
authorization, approval, audit and optimistic-version checks. AI output remains
a proposal requiring human confirmation. Guest demonstration drafts remain in
the browser and must not become anonymous persisted writes. Public projections
must not reveal restricted personnel, financial fields or unauthorized tabs.

## Deliberate publication differences

This repository contains the reviewable source and synthetic fixtures. It
excludes production settings, deployment infrastructure, delivery history,
private source documents, business-data exports, credentials and original
private Git history. Material seed collections are empty. Six source/test files
retain the previous public snapshot's substitutions of Drive identifiers and
the integration mailbox with placeholders or generic administrator wording.
The verification script omits the excluded deployment preflight. These are
documented review-copy differences; do not deploy this copy over production.

The VNA brand assets and historical workbook/contract references already
approved for this review repository remain. No license for reuse is granted.

## Suggested request to ChatGPT

Review the current `main` branch of this repository for concrete defects and
regression risks. Start with this file. Report findings ordered by severity,
with file/line, a reproducible scenario, impact and a focused correction. Pay
particular attention to authorization and public-data leakage, concurrent
saves, idempotency, migration compatibility and spreadsheet export permissions.
Separate demonstrated defects from hypotheses and product suggestions. Do not
change code, merge, deploy, or mutate live CPMS records as part of the review.

## Verification

Checks completed on 17 November 2026:

- The matching full local source passed `scripts/verify.ps1`: lint, 127 test
  files / 726 tests, package/API/web builds, Prisma checks, pilot CLI typecheck,
  PowerShell parsing and deployment preflight.
- This sanitized review copy passed PowerShell parsing, Prisma generation,
  lint, package/API/web builds, pilot CLI typecheck and schema validation.
  The test suite initially passed 725/726 tests; the OpenAPI schema test hit
  its 5-second timeout. Its unchanged three-test file passed on isolated retry
  with the original timeout (the previously timed-out test took 365 ms).
  Verification was completed in stages without changing application code.
- Publication audit: 740 source/documentation files; no protected input paths
  or credential patterns found. Empty Material seed collections and the
  established identifier/mailbox substitutions were checked.
- Local web/login/public Campaign GET returned 200 and anonymous auth returned
  401. Production web returned 200 and anonymous auth returned 401. The running
  production release was rechecked and remained unchanged.

The web build reports a non-blocking bundle-size warning. These checks do not
establish complete authenticated live-workflow acceptance; no live business
record was changed for QA.
