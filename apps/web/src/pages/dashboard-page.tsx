import { Card, Metric, SectionHeading, StatusBadge } from '@cpms/ui';
import { CampaignTable } from '../components/campaign-table';
import { useCampaignWorkspace } from '../campaign-context';
import { selectDashboardMetrics, selectRecentCampaigns } from '../lib/campaign-workspace';
import { AppLink } from '../lib/router';

export function DashboardPage() {
  const { snapshot } = useCampaignWorkspace();
  const campaigns = snapshot.campaigns;
  const { drafts, running, ready } = selectDashboardMetrics(snapshot);
  const recentCampaigns = selectRecentCampaigns(snapshot);

  return (
    <>
      <section className="mb-7 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="relative overflow-hidden border-0 !bg-vna-blue-deep p-7 text-white shadow-panel lg:p-9">
          <div className="absolute -right-16 -top-20 size-64 rounded-full border-[44px] border-vna-gold/15" />
          <div className="relative max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-vna-gold">Tổng quan CPMS</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Điều phối chiến dịch trong một nguồn dữ liệu thống nhất.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-cyan-50/80 sm:text-base">
              Theo dõi tiến độ, mở nhanh hồ sơ gần đây và tiếp tục công việc từ Quản lý Chiến dịch. Mọi cập nhật đều đi qua cùng Application Service và audit actor.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <AppLink className="inline-flex min-h-11 items-center rounded-xl bg-vna-gold px-4 py-2 text-sm font-bold text-vna-blue-deep transition hover:bg-[#e3bc55]" to="/campaigns/new">Tạo chiến dịch</AppLink>
              <AppLink className="inline-flex min-h-11 items-center rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15" to="/campaigns">Mở Quản lý Chiến dịch</AppLink>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeading eyebrow="Nhịp công việc">Tập trung hôm nay</SectionHeading>
          <div className="mt-5 space-y-4">
            <div className="rounded-xl bg-cyan-50 p-4">
              <div className="flex items-center justify-between gap-4"><span className="text-sm font-medium text-slate-600">Đang triển khai</span><StatusBadge tone="positive">{running}</StatusBadge></div>
              <p className="mt-2 text-xs leading-5 text-slate-500">Chiến dịch đang ở trạng thái đang chạy.</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-4">
              <div className="flex items-center justify-between gap-4"><span className="text-sm font-medium text-slate-600">Cần hoàn thiện kế hoạch</span><StatusBadge tone="warning">{ready}</StatusBadge></div>
              <p className="mt-2 text-xs leading-5 text-slate-500">Đang lập kế hoạch hoặc sẵn sàng triển khai.</p>
            </div>
          </div>
        </Card>
      </section>

      <section className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Chỉ số chiến dịch">
        <Metric label="Tổng chiến dịch" value={campaigns.length} hint="Cùng dữ liệu với Quản lý Chiến dịch" />
        <Metric label="Đang triển khai" value={running} hint="Theo trạng thái vòng đời" />
        <Metric label="Đang chuẩn bị" value={ready} hint="Planning và ready to launch" />
        <Metric label="Dự thảo" value={drafts} hint="Cần tiếp tục hoàn thiện" />
      </section>

      {snapshot.error ? (
        <div className="mb-7 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900" role="alert">
          <span className="font-semibold">Chưa tải được chiến dịch.</span> {snapshot.error}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <SectionHeading eyebrow="Cập nhật mới nhất">Chiến dịch gần đây</SectionHeading>
          <AppLink className="text-sm font-semibold text-vna-blue hover:underline" to="/campaigns">Xem toàn bộ chiến dịch →</AppLink>
        </div>
        <CampaignTable campaigns={recentCampaigns} loading={snapshot.loading} emptyMessage="Chưa có chiến dịch. Hãy tạo chiến dịch đầu tiên." />
      </Card>
    </>
  );
}
