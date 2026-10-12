-- Reference-only pilot bootstrap. No Campaign, Material or Booking records are created.
BEGIN;

-- Prisma @updatedAt columns are NOT NULL without a SQL default. Supply one only
-- while inserting reference rows, then restore the original table definition.
ALTER TABLE "market_regions" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "markets" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "organization_units" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "provinces" (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "display_order" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "provinces_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "campaign_provinces" (
  "campaign_id" UUID NOT NULL,
  "province_code" TEXT NOT NULL,
  CONSTRAINT "campaign_provinces_pkey" PRIMARY KEY ("campaign_id", "province_code")
);
CREATE INDEX "campaign_provinces_province_code_idx" ON "campaign_provinces"("province_code");
ALTER TABLE "campaign_provinces" ADD CONSTRAINT "campaign_provinces_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_provinces" ADD CONSTRAINT "campaign_provinces_province_code_fkey" FOREIGN KEY ("province_code") REFERENCES "provinces"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Decision 19/2025/QD-TTg, effective 2025-07-01; official two-digit province codes.
INSERT INTO "provinces" ("code", "name", "display_order") VALUES
('01','Thành phố Hà Nội',1),('04','Tỉnh Cao Bằng',2),('08','Tỉnh Tuyên Quang',3),
('11','Tỉnh Điện Biên',4),('12','Tỉnh Lai Châu',5),('14','Tỉnh Sơn La',6),
('15','Tỉnh Lào Cai',7),('19','Tỉnh Thái Nguyên',8),('20','Tỉnh Lạng Sơn',9),
('22','Tỉnh Quảng Ninh',10),('24','Tỉnh Bắc Ninh',11),('25','Tỉnh Phú Thọ',12),
('31','Thành phố Hải Phòng',13),('33','Tỉnh Hưng Yên',14),('37','Tỉnh Ninh Bình',15),
('38','Tỉnh Thanh Hóa',16),('40','Tỉnh Nghệ An',17),('42','Tỉnh Hà Tĩnh',18),
('44','Tỉnh Quảng Trị',19),('46','Thành phố Huế',20),('48','Thành phố Đà Nẵng',21),
('51','Tỉnh Quảng Ngãi',22),('52','Tỉnh Gia Lai',23),('56','Tỉnh Khánh Hòa',24),
('66','Tỉnh Đắk Lắk',25),('68','Tỉnh Lâm Đồng',26),('75','Tỉnh Đồng Nai',27),
('79','Thành phố Hồ Chí Minh',28),('80','Tỉnh Tây Ninh',29),('82','Tỉnh Đồng Tháp',30),
('86','Tỉnh Vĩnh Long',31),('91','Tỉnh An Giang',32),('92','Thành phố Cần Thơ',33),
('96','Tỉnh Cà Mau',34)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "campaign_levels" ("code","label","rule_description","display_order") VALUES
('CLV_01','Cấp 1 – Cấp Phòng','Ngân sách slot sẵn có ≤200 triệu VND; không phát sinh chi phí QCTT mới.',1),
('CLV_02','Cấp 2 – Cấp Ban','Ngân sách >200 triệu đến ≤1 tỷ VND; không phát sinh chi phí QCTT mới.',2),
('CLV_03','Cấp 3 – TGĐ/PTGĐ','Ngân sách >1 tỷ VND hoặc phát sinh chi phí QCTT mới ngoài hợp đồng đã ký.',3)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "campaign_objectives" ("code","label","requires_other_text","display_order") VALUES
('BRAND_IMAGE','Thương hiệu – hình ảnh',false,1),('SALES_REVENUE','Thúc đẩy bán – doanh thu',false,2),
('AWARENESS','Nâng cao nhận thức',false,3),('RECRUITMENT','Tuyển dụng',false,4),('OTHER','Khác',true,5)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "market_regions" ("code","name","display_order") VALUES
('EUR','Châu Âu',1),('NOA','Bắc Mỹ',2),('NEA','Đông Bắc Á',3),('SEA','Đông Nam Á',4),
('SWP','Tây Nam Thái Bình Dương',5),('CLMV','Campuchia - Lào - Myanmar',6),('SAS','Nam Á',7),('DOM','Nội địa',8)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "markets" ("code","name","region_code","display_order") VALUES
('DE','Đức','EUR',1),('FR','Pháp','EUR',2),('GB','Anh / United Kingdom','EUR',3),('DK','Đan Mạch','EUR',4),
('IT','Ý','EUR',5),('RU','Nga','EUR',6),('NL','Hà Lan','EUR',7),('CZ','Séc','EUR',8),
('US','Mỹ','NOA',9),('CA','Canada','NOA',10),('CN','Trung Quốc','NEA',11),
('HK','Hồng Kông (Trung Quốc)','NEA',12),('JP','Nhật Bản','NEA',13),('KR','Hàn Quốc','NEA',14),
('TW','Đài Loan (Trung Quốc)','NEA',15),('ID','Indonesia','SEA',16),('MY','Malaysia','SEA',17),
('PH','Philippines','SEA',18),('SG','Singapore','SEA',19),('TH','Thái Lan','SEA',20),
('AU','Úc','SWP',21),('KH','Campuchia','CLMV',22),('LA','Lào','CLMV',23),('MM','Myanmar','CLMV',24),
('IN','Ấn Độ','SAS',25),('LK','Sri Lanka','SAS',26),('VN','Việt Nam','DOM',27)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "organization_units" ("code","display_name","category","source_provider","display_order") VALUES
('BAN_TT','Ban TT','QUICK_SELECT','CPMS_REFERENCE',1),('BAN_TTBSP','Ban TTBSP','QUICK_SELECT','CPMS_REFERENCE',2),
('CNVN','CNVN','QUICK_SELECT','CPMS_REFERENCE',3),('TTBSV','TTBSV','QUICK_SELECT','CPMS_REFERENCE',4),
('TT_HERITAGE','TT Heritage','QUICK_SELECT','CPMS_REFERENCE',5),('BAN_DVHK','Ban DVHK','QUICK_SELECT','CPMS_REFERENCE',6),
('DB','ĐB','QUICK_SELECT','CPMS_REFERENCE',7),('DTV','ĐTV','QUICK_SELECT','CPMS_REFERENCE',8),
('ASOC','ASOC','QUICK_SELECT','CPMS_REFERENCE',9),('VPTCT','VPTCT','QUICK_SELECT','CPMS_REFERENCE',10)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "organization_units" ("code","display_name","source_name","source_unit_code","source_unit_id","market_code","category","source_provider","display_order") VALUES
('CNNN_AU','CNNN - AU','CN Úc (CNAU)','CNAU','101','AU','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',1),
('CNNN_CN','CNNN - CN','CN Trung Quốc (CNCN)','CNCN','103','CN','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',2),
('CNNN_DE','CNNN - DE','CN Đức (CNDE)','CNDE','107','DE','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',3),
('CNNN_FR','CNNN - FR','CN Pháp (CNFR)','CNFR','109','FR','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',4),
('CNNN_HK','CNNN - HK','CN Hồng Kông (CNHK)','CNHK','110','HK','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',5),
('CNNN_ID','CNNN - ID','CN Indonesia (CNID)','CNID','111','ID','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',6),
('CNNN_IN','CNNN - IN','CN Ấn Độ (CNIN)','CNIN','112','IN','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',7),
('CNNN_JP','CNNN - JP','CN Nhật Bản (CNJP)','CNJP','113','JP','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',8),
('CNNN_KH','CNNN - KH','CN Campuchia (CNKH)','CNKH','117','KH','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',9),
('CNNN_KR','CNNN - KR','CN Hàn Quốc (CNKR)','CNKR','119','KR','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',10),
('CNNN_LA','CNNN - LA','CN Lào (CNLA)','CNLA','121','LA','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',11),
('CNNN_MY','CNNN - MY','CN Malaysia (CNMY)','CNMY','123','MY','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',12),
('CNNN_MM','CNNN - MM','CN Myanmar (CNMM)','CNMM','124','MM','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',13),
('CNNN_RU','CNNN - RU','CN Nga (CNRU)','CNRU','125','RU','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',14),
('CNNN_SG','CNNN - SG','CN Singapore (CNSG)','CNSG','126','SG','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',15),
('CNNN_TH','CNNN - TH','CN Thái Lan (CNTH)','CNTH','127','TH','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',16),
('CNNN_TW','CNNN - TW','CN Đài Loan (CNTW)','CNTW','128','TW','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',17),
('CNNN_GB','CNNN - GB','CN Anh (CNGB)','CNGB','130','GB','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',18),
('CNNN_US','CNNN - US','CN Mỹ (CNUS)','CNUS','131','US','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',19),
('CNNN_CA','CNNN - CA','CN Canada',NULL,'140','CA','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',20),
('CNNN_CZ','CNNN - CZ','CN Czech',NULL,'141','CZ','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',21),
('CNNN_PH','CNNN - PH','CN Philippin',NULL,'142','PH','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',22),
('CNNN_IT','CNNN - IT','CN Ý (CN ITALY)','CN ITALY','300','IT','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',23),
('CNNN_DK','CNNN - DK','CN Đan Mạch',NULL,'320','DK','FOREIGN_BRANCH','SKYOFFICE_EXTRACT',24)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "content_pillars" ("code","label","year","level","parent_code","effective_start","effective_end") VALUES
('MTH2026_01','Bay cao khát vọng bền vững',2026,1,NULL,'2026-01-01','2026-12-31'),
('MTH2026_02','Bay cao khát vọng 5 sao',2026,1,NULL,'2026-01-01','2026-12-31'),
('MTH2026_03','Bay cao khát vọng cống hiến',2026,1,NULL,'2026-01-01','2026-12-31')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "content_pillars" ("code","label","year","level","parent_code","effective_start","effective_end") VALUES
('MTH2026_01_01','Cánh bay kết nối / Khát vọng kết nối',2026,2,'MTH2026_01','2026-01-01','2026-12-31'),
('MTH2026_01_02','Bay nhẹ cùng VNA',2026,2,'MTH2026_01','2026-01-01','2026-12-31'),
('MTH2026_01_03','Khát vọng vì cộng đồng',2026,2,'MTH2026_01','2026-01-01','2026-12-31'),
('MTH2026_02_01','Thương hiệu',2026,2,'MTH2026_02','2026-01-01','2026-12-31'),
('MTH2026_02_02','SPDV',2026,2,'MTH2026_02','2026-01-01','2026-12-31'),
('MTH2026_02_03','Chuyển đổi số',2026,2,'MTH2026_02','2026-01-01','2026-12-31'),
('MTH2026_02_04','SXKD',2026,2,'MTH2026_02','2026-01-01','2026-12-31'),
('MTH2026_02_05','Giải thưởng',2026,2,'MTH2026_02','2026-01-01','2026-12-31'),
('MTH2026_03_01','Đảng trong tim chúng ta',2026,2,'MTH2026_03','2026-01-01','2026-12-31'),
('MTH2026_03_02','Chuyển động 247',2026,2,'MTH2026_03','2026-01-01','2026-12-31'),
('MTH2026_03_03','Những Cánh Sen Vàng',2026,2,'MTH2026_03','2026-01-01','2026-12-31')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "market_regions" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "markets" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "organization_units" ALTER COLUMN "updated_at" DROP DEFAULT;

COMMIT;
