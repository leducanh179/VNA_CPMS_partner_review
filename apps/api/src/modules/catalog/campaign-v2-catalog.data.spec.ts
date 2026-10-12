import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_LEVEL_ROWS, CAMPAIGN_OBJECTIVE_ROWS, FOREIGN_BRANCH_ROWS, MARKET_REGION_ROWS, MARKET_ROWS,
  PERSONNEL_DIRECTORY_ROWS, QUICK_ORGANIZATION_UNIT_ROWS,
} from '../../../../../database/seed/campaign-v2-catalog.data';

describe('Campaign V2 source catalogs', () => {
  it('contains exactly the approved demo catalog sizes, mappings and stable unique codes', () => {
    expect(CAMPAIGN_LEVEL_ROWS).toHaveLength(3);
    expect(CAMPAIGN_OBJECTIVE_ROWS.map((item) => item.code)).toEqual(['BRAND_IMAGE', 'SALES_REVENUE', 'AWARENESS', 'RECRUITMENT', 'OTHER']);
    expect(MARKET_REGION_ROWS).toHaveLength(8);
    expect(MARKET_ROWS).toHaveLength(27);
    expect(FOREIGN_BRANCH_ROWS).toHaveLength(24);
    expect(QUICK_ORGANIZATION_UNIT_ROWS).toHaveLength(10);
    expect(PERSONNEL_DIRECTORY_ROWS).toHaveLength(18);
    expect(new Set(MARKET_ROWS.map((item) => item.code)).size).toBe(27);
    expect(new Set(FOREIGN_BRANCH_ROWS.map((item) => item.code)).size).toBe(24);
    expect(new Set(PERSONNEL_DIRECTORY_ROWS.map((item) => item.employeeCode)).size).toBe(18);
    expect(MARKET_ROWS.find((item) => item.code === 'CZ')?.regionCode).toBe('EUR');
    expect(MARKET_ROWS.find((item) => item.code === 'RU')?.regionCode).toBe('EUR');
    expect(MARKET_ROWS.find((item) => item.code === 'CA')?.regionCode).toBe('NOA');
    expect(MARKET_ROWS.find((item) => item.code === 'MM')?.regionCode).toBe('CLMV');
    expect(CAMPAIGN_LEVEL_ROWS.map(({ code, label, ruleDescription }) => ({ code, label, ruleDescription }))).toEqual([
      { code: 'CLV_01', label: 'Cấp 1 – Cấp Phòng', ruleDescription: 'Có email từ cấp Phòng đề nghị Ban TT truyền thông, quảng cáo chiến dịch.' },
      { code: 'CLV_02', label: 'Cấp 2 – Cấp Ban', ruleDescription: 'Có văn bản hoặc email từ cấp Ban đề nghị Ban TT QCTT truyền thông, quảng cáo chiến dịch.' },
      { code: 'CLV_03', label: 'Cấp 3 – Cấp TCT', ruleDescription: 'Có văn bản hoặc email từ cấp PTGĐ, TGĐ, HĐQT giao nhiệm vụ cho Ban TT truyền thông, quảng cáo chiến dịch.' },
    ]);
  });

  it('keeps every personnel field needed by the directory modal without spreadsheet errors', () => {
    expect(PERSONNEL_DIRECTORY_ROWS.every((person) => typeof person.employeeCode === 'string'
      && typeof person.fullName === 'string' && typeof person.gender === 'string'
      && typeof person.organizationName === 'string' && 'departmentName' in person
      && typeof person.jobTitle === 'string' && typeof person.phoneText === 'string'
      && typeof person.email === 'string' && Number.isInteger(person.birthYear))).toBe(true);
    expect(JSON.stringify(PERSONNEL_DIRECTORY_ROWS)).not.toContain('#NAME?');
    expect(PERSONNEL_DIRECTORY_ROWS.map((person) => person.employeeCode)).toEqual(
      Array.from({ length: 18 }, (_, index) => `DEMO${String(index + 1).padStart(3, '0')}`),
    );
    expect(PERSONNEL_DIRECTORY_ROWS.map((person) => person.fullName)).toEqual(
      Array.from({ length: 18 }, (_, index) => `Nhân sự Demo ${String(index + 1).padStart(2, '0')}`),
    );
    expect(PERSONNEL_DIRECTORY_ROWS.map((person) => person.email)).toEqual(
      Array.from({ length: 18 }, (_, index) => `demo${String(index + 1).padStart(2, '0')}@example.com`),
    );
    expect(PERSONNEL_DIRECTORY_ROWS.map((person) => person.phoneText)).toEqual(
      Array.from({ length: 18 }, (_, index) => String(index + 1).padStart(10, '0')),
    );
    expect(PERSONNEL_DIRECTORY_ROWS.every((person) => person.birthYear >= 1970 && person.birthYear <= 2003)).toBe(true);
    expect(new Set(PERSONNEL_DIRECTORY_ROWS.map((person) => person.gender)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(PERSONNEL_DIRECTORY_ROWS.map((person) => person.organizationCode)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(PERSONNEL_DIRECTORY_ROWS.map((person) => person.departmentName)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(PERSONNEL_DIRECTORY_ROWS.map((person) => person.jobTitle)).size).toBeGreaterThanOrEqual(10);
  });
});
