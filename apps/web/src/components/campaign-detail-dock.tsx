import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Keep campaign actions in view and leave room for them when scrolling to a form section. */
export function CampaignDetailDock({ children, variant = 'detail' }: { children: ReactNode; variant?: 'detail' | 'entry' }) {
  const dock = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = dock.current;
    if (!element) return;
    const banner = document.querySelector<HTMLElement>('[data-cpms-session-banner]');
    const root = document.documentElement;
    const previousPadding = root.style.scrollPaddingTop;
    const update = () => {
      const offset = banner?.getBoundingClientRect().height ?? 0;
      element.style.top = `${offset}px`;
      // Native focus/scrollIntoView must leave the target below the pinned rows.
      root.style.scrollPaddingTop = `${offset + element.getBoundingClientRect().height + 16}px`;
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    if (banner) observer.observe(banner);
    update();
    return () => {
      observer.disconnect();
      root.style.scrollPaddingTop = previousPadding;
    };
  }, []);

  return <div ref={dock} data-campaign-detail-dock={variant === 'detail' ? '' : undefined} data-campaign-entry-dock={variant === 'entry' ? '' : undefined} className="sticky top-0 z-30 mb-4 space-y-2 rounded-2xl bg-slate-50 pb-2 shadow-sm">{children}</div>;
}
