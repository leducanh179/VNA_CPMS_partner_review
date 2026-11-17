import { createRoot } from 'react-dom/client';
import { AiMessage } from '../../apps/web/src/components/ai-message';
import '../../apps/web/src/index.css';

const example = `## Tư liệu phù hợp cho sự kiện

Đề xuất **phim giới thiệu doanh nghiệp**, bản *30 giây*.

1. Chọn phiên bản theo đối tượng khách mời.
   - Tiếng Việt cho khách trong nước.
   - Tiếng Anh cho khách quốc tế.
2. Kiểm tra hiệu lực sử dụng trước khi trình chiếu.

[Mở hướng dẫn mẫu](https://example.com/guide) · https://example.com/library

| Tư liệu | Ngôn ngữ | Định dạng | Ghi chú |
| --- | --- | --- | --- |
| Phim giới thiệu mẫu | Tiếng Anh | MP4 | Bản trình chiếu sự kiện |
| Bộ ảnh mẫu | Không áp dụng | JPG | Đối chiếu hiệu lực |

> Đây là dữ liệu giả để kiểm tra cách trình bày.

Dùng trường \`campaign.name\` khi xác định hồ sơ.

\`\`\`json
{"name": "Ví dụ", "description": "Dòng mã dài để kiểm tra cuộn ngang trong chat nhỏ và màn hình điện thoại"}
\`\`\`

![Ảnh mẫu](https://example.com/no-auto-load.png)

[Liên kết bị chặn](javascript:alert%281%29)

<script>alert('must-not-run')</script>
`;

function Fixture() {
  return <main className="mx-auto max-w-6xl p-4">
    <h1 className="mb-4 text-xl font-semibold">Kiểm tra trình bày AI — dữ liệu giả</h1>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-label="Câu trả lời trang chính" className="min-w-0 rounded-2xl border bg-white p-5"><AiMessage text={example}/></section>
      <section aria-label="Câu trả lời chat nhỏ" className="min-w-0 rounded-2xl border bg-cyan-50/40 p-4"><AiMessage text={example}/></section>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
