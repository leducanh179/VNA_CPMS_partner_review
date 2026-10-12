-- The source 2026 master plan has one umbrella communication message above the
-- three existing pillars. These broad children classify its cross-pillar items;
-- monthly campaign examples from the reference workbook are not imported.
INSERT INTO "content_pillars" ("code", "label", "year", "level", "parent_code", "effective_start", "effective_end") VALUES
('MTH2026_00', 'Bay cao cùng khát vọng Việt Nam', 2026, 1, NULL, '2026-01-01', '2026-12-31')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "content_pillars" ("code", "label", "year", "level", "parent_code", "effective_start", "effective_end") VALUES
('MTH2026_00_01', 'Dấu mốc đất nước', 2026, 2, 'MTH2026_00', '2026-01-01', '2026-12-31'),
('MTH2026_00_02', 'Kết nối Việt Nam và thế giới', 2026, 2, 'MTH2026_00', '2026-01-01', '2026-12-31'),
('MTH2026_00_03', 'Dấu mốc phát triển Vietnam Airlines', 2026, 2, 'MTH2026_00', '2026-01-01', '2026-12-31')
ON CONFLICT ("code") DO NOTHING;
