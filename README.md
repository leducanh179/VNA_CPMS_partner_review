# CPMS — partner source review snapshot

This is a source-only review snapshot of the CPMS modular monolith (React/Vite,
NestJS, PostgreSQL/Prisma). It is for partner technical assessment, not a
production deployment package or a live-data export. It was refreshed on
26 October 2026 from the online source commit
`e1e3b8515ff101b49adf9caf857f3c5ed434a768`.

The copy deliberately has **no original Git history**, no live database, no
live deployment settings, no historical delivery notes, and no user-provided
Material Portal snapshot. The Material seed exports empty collections so a
fresh database can be initialized without importing real operational records.
The pilot deployment package and its infrastructure-specific configuration are
excluded. Google Drive IDs and the pilot integration mailbox in example code
have been replaced with placeholders. The owner authorized publication of the
source-specific workbook and contract references in the historical Booking
importer; **the source workbook itself is not included**. The online demo may
continue changing after this snapshot.

No open-source license is granted by this repository. Source and Vietnam
Airlines branding are provided for review; obtain separate permission before
reuse, modification, redistribution, or production deployment.

## Local technical review

Use a new isolated PostgreSQL database and copy `.env.example` to `.env`.
The example contains development-only values; choose new local credentials.
Install dependencies with `pnpm install --frozen-lockfile`, then run
`pnpm db:generate`, `pnpm db:migrate:deploy`, and `pnpm db:seed` for an isolated
demo. Run `scripts/verify.ps1` for code checks. The source-only verification
does **not** verify a live database migration or the online demo. No live CPMS
login or data is included; demo access is provisioned separately.

Do not commit `.env`, credentials, database exports, source spreadsheets, or
real user/vendor data into a public fork of this copy.
