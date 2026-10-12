import { LoadingBlock, Toast } from '@cpms/ui';
import { AuthProvider } from './auth-context';
import { AccessCapabilitiesProvider } from './access-context';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { CampaignProvider } from './campaign-context';
import { AppShell } from './components/app-shell';
import { matchRoute, usePathname } from './lib/router';
import { AdminSystemPage } from './pages/admin-system-page';
import { CampaignCockpitPage } from './pages/campaign-cockpit-page';
import { CampaignDetailPage } from './pages/campaign-detail-page';
import { CampaignEditPage } from './pages/campaign-edit-page';
import { CampaignNewPage } from './pages/campaign-new-page';
import { DashboardPage } from './pages/dashboard-page';
import { NotFoundPage } from './pages/not-found-page';
import { MaterialPortalPage } from './pages/material-portal-page';
import { MaterialEditPage, MaterialNewPage } from './pages/material-new-page';
const MyWorkPage = lazy(async () => ({ default: (await import('./pages/my-work-page')).MyWorkPage }));
const DirectoryPage = lazy(async () => ({ default: (await import('./pages/directory-page')).DirectoryPage }));
const QcttCatalogPage = lazy(async () => ({ default: (await import('./pages/qctt-catalog-page')).QcttCatalogPage }));
const QcttPlansPage = lazy(async () => ({ default: (await import('./pages/qctt-plans-page')).QcttPlansPage }));
const BookingsPage = lazy(async () => ({ default: (await import('./pages/bookings-page')).BookingsPage }));
const ContractsPage = lazy(async () => ({ default: (await import('./pages/contracts-page')).ContractsPage }));
const ContractDetailPage = lazy(async () => ({ default: (await import('./pages/contracts-page')).ContractDetailPage }));
const ContractFormPage = lazy(async () => ({ default: (await import('./pages/contract-form-page')).ContractFormPage }));
const AdminAccountsPage = lazy(async () => ({ default: (await import('./pages/admin-accounts-page')).AdminAccountsPage }));
const AdminAccessPage = lazy(async () => ({ default: (await import('./pages/admin-access-page')).AdminAccessPage }));
const AdminWorkflowPage = lazy(async () => ({ default: (await import('./pages/admin-workflow-page')).AdminWorkflowPage }));

function RoutedApplication() {
  const pathname = usePathname();
  const route = useMemo(() => matchRoute(pathname), [pathname]);
  const [toast, setToast] = useState<string | null>(null);
  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  let page;
  switch (route.name) {
    case 'qctt-plans':
      page = <QcttPlansPage />;
      break;
    case 'qctt-plan-detail':
      page = <QcttPlansPage campaignId={route.id} />;
      break;
    case 'qctt-catalog':
      page = <QcttCatalogPage />;
      break;
    case 'directory':
      page = <DirectoryPage />;
      break;
    case 'bookings':
      page = <BookingsPage />;
      break;
    case 'contracts':
      page = <ContractsPage />;
      break;
    case 'contract-new':
      page = <ContractFormPage key={route.owned ? 'owned' : 'paid'} owned={route.owned} />;
      break;
    case 'contract-edit':
      page = <ContractFormPage key={route.id} id={route.id} />;
      break;
    case 'contract-detail':
      page = <ContractDetailPage key={route.id} id={route.id} />;
      break;
    case 'dashboard':
      page = <DashboardPage />;
      break;
    case 'campaigns':
      page = <CampaignCockpitPage notify={notify} />;
      break;
    case 'campaign-new':
      page = <CampaignNewPage notify={notify} />;
      break;
    case 'campaign-detail':
      page = <CampaignDetailPage id={route.id} notify={notify} />;
      break;
    case 'campaign-edit':
      page = <CampaignEditPage id={route.id} notify={notify} />;
      break;
    case 'materials':
      page = <MaterialPortalPage notify={notify} />;
      break;
    case 'material-new':
      page = <MaterialNewPage notify={notify} />;
      break;
    case 'material-edit':
      page = <MaterialEditPage key={route.id} id={route.id} notify={notify} />;
      break;
    case 'admin-system':
      page = <AdminSystemPage />;
      break;
    case 'admin-accounts':
      page = <AdminAccountsPage />;
      break;
    case 'admin-access':
      page = <AdminAccessPage />;
      break;
    case 'admin-workflow':
      page = <AdminWorkflowPage />;
      break;
    case 'my-work':
      page = <MyWorkPage />;
      break;
    default:
      page = <NotFoundPage />;
  }

  return (
    <AppShell pathname={pathname}>
      <Suspense fallback={<LoadingBlock label="Đang mở màn hình…" />}>{page}</Suspense>
      {toast ? <Toast>{toast}</Toast> : null}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider><AccessCapabilitiesProvider><CampaignProvider>
      <RoutedApplication />
    </CampaignProvider></AccessCapabilitiesProvider></AuthProvider>
  );
}
