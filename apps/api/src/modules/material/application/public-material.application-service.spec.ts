import { describe, expect, it, vi } from 'vitest';
import type { MaterialSummary } from '@cpms/domain';
import type { MaterialSharingRepository } from './material-sharing.repository';
import { publicMaterialProjection, PublicMaterialApplicationService } from './public-material.application-service';
import { isPublicMaterialRead, PublicMaterialRateLimit } from '../../auth/public-material-read';

const row: MaterialSummary = { id: 'internal', materialId: 'MTR-TEST', recordVersion: 6, isDeleted: false, updatedAt: 'now',
  sharing: { mode: 'SHARED', ownerActorId: 'secret-actor', campaignIds: ['secret-campaign'], grants: [] },
  fields: { material_name: 'Example', material_link: 'https://example.test/folder', publish_status: 'NOT_PUBLISHED', created_by: 'secret',
    note: 'private internal note', contract_ids: 'secret-contract', campaign_refs: '[{"id":"secret-campaign"}]', material_languages: '["Tiếng Việt"]' } };
describe('Anonymous material surface', () => {
  it('M03/M13/M16/M18: explicit allowlist includes unpublished saved content and link without changing Drive ACL', () => {
    const value = publicMaterialProjection(row);
    expect(value.url).toBe('https://example.test/folder');
    expect(JSON.stringify(value)).not.toMatch(/secret|private internal|recordVersion|sharing/);
    expect(Object.keys(value).sort()).toEqual(['materialId','title','group','type','description','languages','markets','url','updateDate'].sort());
  });
  it('M03: pagination and bounded search are delegated with server-selected audience', async () => {
    const repository = { publicList: vi.fn(async () => ({ records: [row], total: 1 })) } as unknown as MaterialSharingRepository;
    const service = new PublicMaterialApplicationService(repository);
    expect(await service.list({ q: 'Example', page: '2', pageSize: '10' })).toMatchObject({ page: 2, pageSize: 10, total: 1 });
    expect(repository.publicList).toHaveBeenCalledWith('Example', 2, 10);
    await expect(service.list({ pageSize: '1000' })).rejects.toThrow();
    await expect(service.list({ q: 'x'.repeat(101) })).rejects.toThrow();
  });
  it('M05: nonexistent, restricted and trash use the same application 404', async () => {
    const repository = { publicDetail: vi.fn(async () => null) } as unknown as MaterialSharingRepository;
    const service = new PublicMaterialApplicationService(repository);
    for (const id of ['missing', 'restricted', 'trash']) await expect(service.detail(id)).rejects.toMatchObject({ status: 404, message: 'Không tìm thấy tư liệu.' });
  });
  it('M04: only exact anonymous GET paths bypass session middleware', () => {
    expect(isPublicMaterialRead('GET', '/api/public/materials')).toBe(true);
    expect(isPublicMaterialRead('GET', '/api/public/materials/MTR-TEST')).toBe(true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) expect(isPublicMaterialRead(method, '/api/public/materials')).toBe(false);
    for (const path of ['/api/materials','/api/public/materials/a/comments','/api/public/materials/a/journal','/api/public/materials/a%2fcomments','/api/public/materials/../directory','/api/auth/me','/api/public/materials-old']) expect(isPublicMaterialRead('GET', path)).toBe(false);
  });
  it('bounds anonymous request bursts without adding infrastructure', () => {
    const limit = new PublicMaterialRateLimit();
    for (let i = 0; i < 120; i++) expect(limit.allow('client', 1)).toBe(true);
    expect(limit.allow('client', 1)).toBe(false);
    expect(limit.allow('other', 1)).toBe(true);
    expect(limit.allow('client', 60002)).toBe(true);
  });
});
