import { CpmsIcon } from '@cpms/ui';

/** Shared frozen-column marker; accessible text stays available without a visible badge label. */
export function PinnedColumnIndicator({ label }: { label: string }) {
  return <span role="img" aria-label={`Cột ${label} đã ghim`} title={`Cột ${label} đã ghim`}
    className="inline-flex shrink-0 items-center rounded bg-cyan-700 p-1 text-white"><CpmsIcon name="pin" size={14}/></span>;
}
