-- Keep personnel identities distinct from removable pilot administrators.
ALTER TABLE "actors" DROP CONSTRAINT "actors_account_kind_check";
ALTER TABLE "actors" ADD CONSTRAINT "actors_account_kind_check" CHECK (
  "account_kind" IN ('LEGACY', 'PERSONNEL', 'PILOT_ADMIN') AND "authz_version" > 0 AND
  ("account_kind" <> 'PERSONNEL' OR ("personnel_employee_code" IS NOT NULL AND "login_email" IS NOT NULL)) AND
  ("account_kind" <> 'PILOT_ADMIN' OR ("personnel_employee_code" IS NULL AND "login_email" IS NOT NULL)) AND
  ("login_email" IS NULL OR "login_email" = lower(btrim("login_email")))
);
