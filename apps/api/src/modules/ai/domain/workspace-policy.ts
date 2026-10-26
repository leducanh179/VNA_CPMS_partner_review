import { z } from 'zod';
import type { AiWorkspacePolicy } from '@cpms/ai-contracts';
export const DEFAULT_AI_POLICY: AiWorkspacePolicy = {
  agentEnabled: true, libraryEnabled: false, spreadsheetId: '', allowedRootIds: [],
  maxQuestions: 2, maxResults: 5, includeUnknownRights: true, answerFormat: 'CARDS',
  instructions: '', selectionRules: 'Ưu tiên tư liệu phù hợp mục đích sử dụng. Nêu rõ nếu chưa biết hiệu lực sử dụng. Không khẳng định đã xem ảnh khi mới tra chỉ mục.',
  vision: { enabled: false, maxImagesPerRequest: 10, monthlyLimitVnd: 0 },
};
export const workspacePolicySchema = z.object({
  agentEnabled: z.boolean(), libraryEnabled: z.boolean(), spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{10,150}$|^$/),
  allowedRootIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{10,150}$/)).max(100),
  maxQuestions: z.number().int().min(0).max(2), maxResults: z.number().int().min(1).max(5),
  includeUnknownRights: z.boolean(), answerFormat: z.enum(['CARDS', 'TABLE']),
  instructions: z.string().trim().max(1500), selectionRules: z.string().trim().max(1000),
  vision: z.object({ enabled: z.literal(false), maxImagesPerRequest: z.number().int().min(1).max(20), monthlyLimitVnd: z.literal(0) }).strict(),
}).strict().refine(p => !p.libraryEnabled || Boolean(p.spreadsheetId), 'Cần ID Google Sheet để bật thư viện.');
export function policyOrDefault(raw: unknown): AiWorkspacePolicy {
  return workspacePolicySchema.parse({ ...DEFAULT_AI_POLICY, ...(raw && typeof raw === 'object' ? raw : {}) });
}
export function policyInstructions(policy: AiWorkspacePolicy, version: number, remainingQuestions: number) {
  return `Cấu hình quản trị v${version}. Các hướng dẫn dưới đây không thay thế quyền, giới hạn ngân sách hoặc yêu cầu xác nhận trước ghi dữ liệu.
Tra thư viện: ${policy.libraryEnabled ? 'bật' : 'tắt'}. Đề xuất nhập liệu: ${policy.agentEnabled ? 'bật' : 'tắt'}.
Tìm tư liệu QCTT bằng search_library. Kết hợp từ đặc trưng nội dung/tên phim/địa điểm với phiên bản, ngôn ngữ, định dạng khi đã biết; tên thư mục cũng được tìm. Khi tinh chỉnh luôn giữ từ đặc trưng chủ đề để tránh lấy phim/ảnh khác chỉ trùng thông số. Đọc cả tên và đường dẫn để đối chiếu nhu cầu; tối đa 5 kết quả không phải toàn kho. Không lặp lại cùng query đã không khớp nhu cầu. Tách mediaType PHOTO/VIDEO/FOLDER/ANY. Không coi metadata là đã xem nội dung ảnh. Chỉ trả link từ công cụ. Không suy ra quyền sử dụng từ ACTIVE. Nêu hiệu lực và thời điểm cập nhật nguồn.
Nếu thiếu thông tin quan trọng, gọi ask_library_questions với tối đa ${remainingQuestions} câu ngắn, gợi ý lựa chọn; chỉ hỏi phần chưa biết. Nếu người dùng bảo đề xuất trước thì tìm ngay và nói giả định. Không hỏi thêm bằng văn bản ngoài công cụ này. Khi đủ dữ kiện, trả tối đa ${policy.maxResults} kết quả.
Nếu người dùng muốn nhập/sửa hồ sơ, đọc get_campaign trước, rồi prepare_campaign_update để tạo bản đề xuất; không được nói đã lưu hoặc đã gửi duyệt. Chỉ giao diện xác nhận mới thực hiện việc ghi. Hỗ trợ hiện tại: hồ sơ Chiến dịch đã lưu; các phân hệ khác chỉ đọc/soạn thảo.
Quy tắc chọn: ${policy.selectionRules}
Hướng dẫn trả lời: ${policy.instructions}`;
}
