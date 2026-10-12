CREATE TABLE qctt_catalog_entries (
  code TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('LAYER','CHANNEL','ACTIVITY','PILLAR','TOPIC')),
  name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','DRAFT')),
  layer_code TEXT REFERENCES qctt_catalog_entries(code) ON DELETE RESTRICT,
  channel_code TEXT REFERENCES qctt_catalog_entries(code) ON DELETE RESTRICT,
  parent_code TEXT REFERENCES qctt_catalog_entries(code) ON DELETE RESTRICT,
  owner_org_id UUID, owner_org_name TEXT NOT NULL DEFAULT '', supply_type TEXT CHECK (supply_type IN ('PAID','INTERNAL')),
  year INTEGER, effective_from DATE, effective_to DATE, sort_order INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  source JSONB NOT NULL DEFAULT '{}', record_version INTEGER NOT NULL DEFAULT 1, deleted_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
);
CREATE INDEX qctt_catalog_entries_kind_status_deleted_at_sort_order_idx ON qctt_catalog_entries(kind,status,deleted_at,sort_order);
CREATE TABLE qctt_catalog_state (key TEXT PRIMARY KEY, record_version INTEGER NOT NULL DEFAULT 1);
ALTER TABLE qctt_plan_items ADD COLUMN custom_values JSONB NOT NULL DEFAULT '{}';
CREATE TABLE qctt_catalog_revisions (id UUID PRIMARY KEY, code TEXT NOT NULL, version INTEGER NOT NULL,
  actor_id UUID NOT NULL, action TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX qctt_catalog_revisions_code_version_key ON qctt_catalog_revisions(code,version);
CREATE TABLE qctt_catalog_reserved_codes (code TEXT PRIMARY KEY, kind TEXT NOT NULL);
CREATE TABLE qctt_catalog_commands (id UUID PRIMARY KEY, actor_id UUID NOT NULL, key TEXT NOT NULL,
  digest TEXT NOT NULL, result JSONB NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX qctt_catalog_commands_actor_id_key_key ON qctt_catalog_commands(actor_id,key);
CREATE TRIGGER immutable_qctt_catalog_revision BEFORE UPDATE OR DELETE ON qctt_catalog_revisions
FOR EACH ROW EXECUTE FUNCTION cpms_workflow_history_immutable();
CREATE TRIGGER immutable_qctt_catalog_command BEFORE UPDATE OR DELETE ON qctt_catalog_commands
FOR EACH ROW EXECUTE FUNCTION cpms_workflow_history_immutable();
CREATE TRIGGER immutable_qctt_catalog_reserved_code BEFORE UPDATE OR DELETE ON qctt_catalog_reserved_codes
FOR EACH ROW EXECUTE FUNCTION cpms_workflow_history_immutable();

-- Preserve existing classifications as a bootstrap. No source descriptions are imported.
INSERT INTO qctt_catalog_entries(code,kind,name,sort_order,source)
SELECT e->>'code','LAYER',e->>'name',ordinality::int,jsonb_build_object('origin','LEGACY_CATALOG')
FROM supply_channel_catalogs, jsonb_array_elements(data->'layers') WITH ORDINALITY AS x(e,ordinality) WHERE id='vna';
INSERT INTO qctt_catalog_entries(code,kind,name,sort_order,source)
SELECT e->>'code','CHANNEL',e->>'name',ordinality::int,jsonb_build_object('origin','LEGACY_CATALOG')
FROM supply_channel_catalogs, jsonb_array_elements(data->'channels') WITH ORDINALITY AS x(e,ordinality) WHERE id='vna';
INSERT INTO qctt_catalog_entries(code,kind,name,status,layer_code,channel_code,supply_type,sort_order,owner_org_name,source)
SELECT e->>'code','ACTIVITY',e->>'name','DRAFT',e->>'professionLayer',e->>'channelCode',e->>'supplyType',ordinality::int,
  'Chưa rà soát',jsonb_build_object('origin','LEGACY_CATALOG','requiresReview',true)
FROM supply_channel_catalogs, jsonb_array_elements(data->'activities') WITH ORDINALITY AS x(e,ordinality) WHERE id='vna';
INSERT INTO qctt_catalog_entries(code,kind,name,status,year,effective_from,effective_to,source)
SELECT code,'PILLAR',label,CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END,year,effective_start,effective_end,
  jsonb_build_object('origin','CONTENT_PILLAR') FROM content_pillars WHERE level=1;
INSERT INTO qctt_catalog_entries(code,kind,name,status,parent_code,year,effective_from,effective_to,source)
SELECT code,'TOPIC',label,CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END,parent_code,year,effective_start,effective_end,
  jsonb_build_object('origin','CONTENT_PILLAR') FROM content_pillars WHERE level=2;
INSERT INTO qctt_catalog_state(key) VALUES ('qctt');
INSERT INTO permission_definitions(code,label,module,group_label,description,supported_scopes,implementation_status) VALUES
 ('catalog.manage','Quản lý danh mục QCTT','CATALOG','Danh mục QCTT','Nhập, sửa và quản lý Thùng rác danh mục QCTT.',ARRAY['SYSTEM','MODULE'],'IMPLEMENTED'),
 ('catalog.purge','Xóa vĩnh viễn danh mục QCTT','CATALOG','Danh mục QCTT','Chỉ xóa mục trong Thùng rác không có tham chiếu. Giữ mã và audit.',ARRAY['SYSTEM','MODULE'],'IMPLEMENTED');
