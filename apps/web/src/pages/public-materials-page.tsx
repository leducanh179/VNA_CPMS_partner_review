import type { PublicMaterial } from '@cpms/domain';
import { Button, Card, CpmsIcon } from '@cpms/ui';
import { useEffect, useState } from 'react';
import { materialRichText, richTextPlainValue } from '../lib/material-form';
import { AppLink } from '../lib/router';

export function PublicMaterialsPage({ id }: { id?: string }) {
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(1);
  const [items, setItems] = useState<PublicMaterial[]>([]), [total, setTotal] = useState(0), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setItems([]); setError('');
    const path = id ? `/${encodeURIComponent(id)}` : `?${new URLSearchParams({ q: query, page: String(page), pageSize: '20' })}`;
    // Anonymous endpoint intentionally never carries a session or obtains a fake actor.
    void fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/public/materials${path}`, { credentials: 'omit', cache: 'no-store', signal: controller.signal })
      .then(async response => { if (!response.ok) throw Error(response.status === 404 ? 'Không tìm thấy tư liệu.' : 'Không tải được tư liệu. Vui lòng thử lại.'); return response.json(); })
      .then((result: PublicMaterial | { items: PublicMaterial[]; total: number }) => { if ('items' in result) { setItems(result.items); setTotal(result.total); } else { setItems([result]); setTotal(1); } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, query, page]);
  return <main className="min-h-screen bg-slate-50 p-5 md:p-10"><div className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-vna-blue">CPMS · Không gian dùng chung</p><h1 className="mt-2 text-3xl font-semibold">Tư liệu QCTT</h1></div><a href="/materials" className="text-sm font-semibold text-vna-blue">Đăng nhập CPMS</a></header>
    <p className="text-sm text-slate-600">Tư liệu được chia sẻ công khai. Quyền mở đường dẫn phụ thuộc nhà cung cấp hoặc Google Drive.</p>
    {id ? <AppLink to="/public/materials" className="inline-flex gap-2 text-vna-blue"><CpmsIcon name="back"/>Danh sách tư liệu</AppLink> : <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(q); }}><input aria-label="Tìm tư liệu dùng chung" maxLength={100} className="min-w-0 flex-1 rounded-xl border p-3" value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm mã, tiêu đề, loại tư liệu"/><Button type="submit"><CpmsIcon name="search"/>Tìm kiếm</Button></form>}
    {error && <p role="alert" className="text-rose-800">{error}</p>}{loading && <p role="status">Đang tải…</p>}
    {items.map(m => <Card key={m.materialId} className="space-y-3 p-5"><p className="text-xs text-slate-500">{m.materialId} · {m.type} · {m.updateDate}</p><h2 className="text-xl font-semibold"><AppLink to={`/public/materials/${encodeURIComponent(m.materialId)}`} className="text-vna-blue">{m.title}</AppLink></h2><p className="text-sm text-slate-600">{m.languages.join(' · ')}{m.markets.length ? ` · ${m.markets.join(', ')}` : ''}</p>{id && m.description && <p className="whitespace-pre-wrap text-sm">{richTextPlainValue(materialRichText(m.description, null))}</p>}{m.url && <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-vna-blue"><CpmsIcon name="externalLink"/>Mở Link tư liệu</a>}</Card>)}
    {!loading && !error && !items.length && <p>Không có tư liệu phù hợp.</p>}
    {!id && !error && <div className="flex items-center justify-between"><p className="text-sm">{total} tư liệu · Trang {page}</p><div className="flex gap-2"><Button variant="secondary" disabled={loading || page <= 1} onClick={() => setPage(p => p - 1)}>Trước</Button><Button variant="secondary" disabled={loading || page * 20 >= total} onClick={() => setPage(p => p + 1)}>Sau</Button></div></div>}
  </div></main>;
}
