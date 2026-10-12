UPDATE "campaign_levels"
SET "rule_description" = CASE "code"
  WHEN 'CLV_01' THEN 'Có email từ cấp Phòng đề nghị Ban TT truyền thông, quảng cáo chiến dịch.'
  WHEN 'CLV_02' THEN 'Có văn bản hoặc email từ cấp Ban đề nghị Ban TT QCTT truyền thông, quảng cáo chiến dịch.'
  WHEN 'CLV_03' THEN 'Có văn bản hoặc email từ cấp PTGĐ, TGĐ, HĐQT giao nhiệm vụ cho Ban TT truyền thông, quảng cáo chiến dịch.'
END,
"label" = CASE "code"
  WHEN 'CLV_03' THEN 'Cấp 3 – Cấp TCT'
  ELSE "label"
END
WHERE "code" IN ('CLV_01', 'CLV_02', 'CLV_03');
