import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { parseMaterialLanguages, type MaterialSummary, type PublicMaterial } from '@cpms/domain';
import { MaterialSharingRepository } from './material-sharing.repository';

export function publicMaterialProjection(record: MaterialSummary): PublicMaterial {
  const f = record.fields;
  const url = f.material_link?.trim() ?? '';
  return { materialId: record.materialId, title: (f.material_name || record.materialId).slice(0, 500),
    group: (f.material_group || '').slice(0, 100), type: (f.material_type_other || f.material_type || '').slice(0, 200),
    description: f.material_description_rich_text && f.material_description_rich_text.length <= 32000 ? f.material_description_rich_text : null,
    languages: parseMaterialLanguages(f.material_languages).slice(0, 20),
    markets: (f.market_codes || '').split(',').map(v => v.trim().slice(0, 80)).filter(Boolean).slice(0, 100),
    url: /^https?:\/\//i.test(url) && url.length <= 4096 ? url : '', updateDate: (f.material_update_date || '').slice(0, 10) };
}
/** Explicit anonymous read boundary. Does not install an actor or call internal write/read commands. */
@Injectable()
export class PublicMaterialApplicationService {
  constructor(@Inject(MaterialSharingRepository) private readonly repository: MaterialSharingRepository) {}
  async list(input: { q?: string; page?: string; pageSize?: string }) {
    const page = Number(input.page || 1), pageSize = Number(input.pageSize || 20), query = (input.q || '').trim();
    if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 || query.length > 100)
      throw new BadRequestException('Giới hạn truy vấn không hợp lệ.');
    const result = await this.repository.publicList(query, page, pageSize);
    return { items: result.records.map(publicMaterialProjection), total: result.total, page, pageSize };
  }
  async detail(id: string) {
    const row = id.length <= 120 ? await this.repository.publicDetail(id) : null;
    if (!row) throw new NotFoundException('Không tìm thấy tư liệu.');
    return publicMaterialProjection(row);
  }
}
