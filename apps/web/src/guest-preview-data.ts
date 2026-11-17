export type GuestSection = 'ai' | 'overview' | 'my-work' | 'campaigns' | 'qctt-plans' | 'materials' | 'contracts' | 'bookings';
export type GuestForm = 'campaign' | 'contract' | 'booking' | 'material';
export type GuestRoute =
  | { kind: 'section'; section: GuestSection }
  | { kind: 'campaign-info'; id: string }
  | { kind: 'form'; form: GuestForm }
  | { kind: 'denied' };

const SECTIONS: Readonly<Record<string, GuestSection>> = {
  '/': 'ai', '/overview': 'overview', '/my-work': 'my-work', '/campaigns': 'campaigns',
  '/qctt-plans': 'qctt-plans', '/materials': 'materials', '/contracts': 'contracts', '/bookings': 'bookings',
};
const FORMS: Readonly<Record<string, GuestForm>> = {
  '/campaigns/new': 'campaign', '/contracts/new': 'contract', '/bookings/new': 'booking', '/materials/new': 'material',
};

export function guestRoute(pathname: string): GuestRoute {
  const path = pathname === '/' ? pathname : pathname.replace(/\/+$/, '');
  if (SECTIONS[path]) return { kind: 'section', section: SECTIONS[path] };
  if (FORMS[path]) return { kind: 'form', form: FORMS[path] };
  const match = /^\/campaigns\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(path);
  if (match?.[1]) return { kind: 'campaign-info', id: match[1] };
  return { kind: 'denied' };
}
