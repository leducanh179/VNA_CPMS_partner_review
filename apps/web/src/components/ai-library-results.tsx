import type { AiArtifacts } from '@cpms/ai-contracts';
export function AiLibraryResults({ artifacts }: { artifacts: AiArtifacts }) {
  const items = artifacts.library;
  if (!items?.length) return null;
  const link = (item: (typeof items)[number]) => <a href={item.href} target="_blank" rel="noreferrer" className="font-medium text-vna-blue underline">{item.name}</a>;
  return <section aria-label="Tư liệu tìm được" className="mt-4 text-xs">
    <h3 className="mb-2 font-semibold">Tư liệu từ thư viện QCTT</h3>
    {artifacts.answerFormat === 'TABLE' ? <div className="overflow-x-auto"><table className="w-full border-collapse text-left"><thead><tr><th className="p-2">Tư liệu</th><th className="p-2">Phù hợp / hiệu lực</th></tr></thead><tbody>{items.map(item=><tr key={item.id} className="border-t"><td className="p-2 align-top">{link(item)}<p>{item.format}</p></td><td className="p-2"><p>Từ khóa khớp: {item.matchedTerms.join(', ') || 'Theo loại tư liệu'}</p><p>{item.rights}</p><p>{item.rightsNote}</p><p>Nguồn cập nhật: {item.sourceUpdatedAt || 'Chưa rõ'}</p></td></tr>)}</tbody></table></div> :
      <div className="space-y-2">{items.map(item=><article key={item.id} className="rounded-xl border bg-white p-3">
        {link(item)}<p className="mt-1 break-words text-slate-500">{item.format} · {item.path}</p>
        <p className="mt-2">Khớp: {item.matchedTerms.join(', ') || 'Loại tư liệu đã chọn'}</p><p>Hiệu lực sử dụng: {item.rights}{item.rightsNote ? ` · ${item.rightsNote}` : ''}</p>
        <p className="mt-1 text-slate-500">Nguồn cập nhật: {item.sourceUpdatedAt || 'Chưa rõ'}</p>
      </article>)}</div>}
    <p className="mt-2 text-slate-500">Tra từ chỉ mục, chưa xem nội dung ảnh/file. Đồng bộ vào CPMS: {artifacts.librarySyncedAt ? new Date(artifacts.librarySyncedAt).toLocaleString('vi-VN') : 'Chưa rõ'}.</p>
  </section>;
}
