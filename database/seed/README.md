# Demo seed

The seed is idempotent. It creates the fixed role catalog, the `demo-superuser` actor with the `ADMIN` role, three synthetic campaigns, and an audit event attributed to that actor. It also upserts the normalized Material Portal snapshot: 175 material records plus the user, permission, contract, campaign-reference, rule, setting, Viber-template, and legacy-audit rows used by the attached Apps Script portal.

It does not import `local-source` data and does not assign wildcard permissions to `GUEST`. Material records are keyed by `material_id`, so rerunning the seed updates the source snapshot without duplicating rows.

The private VNA channel map is not bundled into seed data. After the additive channel-catalog migration, import an authorized snapshot through the Contract Application Service (`POST /api/contracts/channel-map/import`). Re-importing identical content is idempotent; seed runs do not overwrite the live catalog, owned-source profiles or item classifications.
