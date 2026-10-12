# CPMS — partner source review snapshot

This is a source-only review snapshot of the CPMS modular monolith (React/Vite,
NestJS, PostgreSQL/Prisma). It is for partner technical assessment, not a
production deployment package or a live-data export. Its baseline is commit
`1b071fb66a0b1f0f9f1ae1a19e81013acabbaece`.

The copy deliberately has **no original Git history**, no live database, no
live deployment settings, no historical delivery notes, and no user-provided
Material Portal snapshot. The Material seed exports empty collections so a
fresh database can be initialized without importing real operational records.
The pilot deployment package is excluded because it is specific to the live
infrastructure. The owner authorized publication of the source-specific
workbook and contract references in the historical Booking importer; **the
source workbook itself is not included**. This snapshot may differ from the
live CPMS as development continues.

No open-source license is granted by this repository. Source and Vietnam
Airlines branding are provided for review; obtain separate permission before
reuse, modification, redistribution, or production deployment.

## Local technical review

Use a new isolated PostgreSQL database and copy `.env.example` to `.env`.
The example contains development-only values; choose new local credentials.
Install dependencies with `pnpm install --frozen-lockfile`, then run
`pnpm db:generate`, `pnpm db:migrate:deploy`, and `pnpm db:seed` for an isolated
demo. Run `scripts/verify.ps1` for code checks. This snapshot passed that
script on 13 October 2026: 94 test files, 557 tests, lint, application builds,
Prisma validation, and pilot CLI typecheck, using a non-running synthetic
database URL. This does **not** verify a live database migration or the online
demo. No live CPMS login or data is included; demo access is provisioned
separately.

Do not commit `.env`, credentials, database exports, source spreadsheets, or
real user/vendor data into a public fork of this copy.
