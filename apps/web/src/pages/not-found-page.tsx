import { Card } from '@cpms/ui';
import { AppLink } from '../lib/router';

export function NotFoundPage() {
  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-vna-gold-dark">404</p>
      <h1 className="mt-3 text-2xl font-semibold text-slate-950">Không tìm thấy trang</h1>
      <p className="mt-2 text-sm text-slate-600">Đường dẫn này không thuộc App Shell CPMS.</p>
      <AppLink className="mt-5 inline-flex min-h-10 items-center rounded-xl bg-vna-blue px-4 py-2 text-sm font-semibold text-white" to="/">Về Tổng quan</AppLink>
    </Card>
  );
}
