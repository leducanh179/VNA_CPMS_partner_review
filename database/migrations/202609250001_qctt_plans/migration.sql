-- Additive planning workspace. Existing immutable campaign_plans and bookings are preserved.
CREATE TABLE qctt_plans (
  campaign_id uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE RESTRICT,
  record_version integer NOT NULL DEFAULT 1,
  initialized_at timestamptz(3), initialized_by_actor_id uuid REFERENCES actors(id) ON DELETE RESTRICT
);
CREATE TABLE qctt_plan_items (
  id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES qctt_plans(campaign_id) ON DELETE RESTRICT,
  record_version integer NOT NULL DEFAULT 1, sort_order integer NOT NULL DEFAULT 0,
  origin text NOT NULL DEFAULT 'MANUAL' CHECK (origin IN ('MANUAL','BOOKING')),
  profession_layer text, channel_code text, activity_code text, activity_label text NOT NULL,
  content jsonb, format text CHECK (format IN ('WRITE','FILM','PHOTO','OTHER')), other_format text NOT NULL DEFAULT '',
  start_date date, end_date date, department_id uuid REFERENCES employment_org_units(id) ON DELETE RESTRICT,
  requirements text NOT NULL DEFAULT '', progress text NOT NULL DEFAULT 'PLANNED' CHECK (progress IN ('PLANNED','IN_PROGRESS','COMPLETED','STOPPED')),
  classification jsonb, deleted_at timestamptz(3), created_by_actor_id uuid NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz(3) NOT NULL,
  CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
CREATE INDEX qctt_plan_items_campaign_id_deleted_at_sort_order_idx ON qctt_plan_items(campaign_id, deleted_at, sort_order);
CREATE TABLE qctt_plan_item_revisions (
  id uuid PRIMARY KEY, item_id uuid NOT NULL REFERENCES qctt_plan_items(id) ON DELETE RESTRICT,
  version integer NOT NULL, actor_id uuid NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  action text NOT NULL, data jsonb NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(item_id, version)
);
CREATE TABLE qctt_plan_commands (
  id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  key uuid NOT NULL, digest text NOT NULL, result jsonb NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id, key)
);
ALTER TABLE booking_records ADD COLUMN plan_item_id uuid REFERENCES qctt_plan_items(id) ON DELETE RESTRICT;
CREATE INDEX booking_records_plan_item_id_idx ON booking_records(plan_item_id);
