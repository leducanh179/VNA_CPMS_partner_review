export interface TimelineDayTick {
  date: Date;
  left: number;
  width: number;
}

export interface TimelineDayHeader {
  day: string;
  weekday: string;
  tooltip: string;
  isWeekend: boolean;
  isMonthStart: boolean;
}

export interface TimelineMonthGroup {
  key: string;
  label: string;
  left: number;
  width: number;
  dayCount: number;
}

interface TimelineColumnRevealOptions {
  currentScrollLeft: number;
  viewportWidth: number;
  contentWidth: number;
  columnLeft: number;
  columnWidth: number;
  pinnedWidth: number;
}

export function timelineColumnRevealScrollLeft({
  currentScrollLeft,
  viewportWidth,
  contentWidth,
  columnLeft,
  columnWidth,
  pinnedWidth,
}: TimelineColumnRevealOptions): number {
  const inset = 12;
  const visibleLeft = currentScrollLeft + pinnedWidth + inset;
  const visibleRight = currentScrollLeft + viewportWidth - inset;
  if (columnLeft >= visibleLeft && columnLeft + columnWidth <= visibleRight) return currentScrollLeft;
  return Math.min(Math.max(0, contentWidth - viewportWidth), Math.max(0, columnLeft - pinnedWidth - inset));
}

const WEEKDAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const;
const WEEKDAY_FULL = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'] as const;

export function timelineDayHeader(date: Date): TimelineDayHeader {
  const weekdayIndex = date.getUTCDay();
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return {
    day,
    weekday: WEEKDAY_SHORT[weekdayIndex] ?? '—',
    tooltip: `${WEEKDAY_FULL[weekdayIndex] ?? 'Không xác định'}, ${day}/${month}/${date.getUTCFullYear()}`,
    isWeekend: weekdayIndex === 0 || weekdayIndex === 6,
    isMonthStart: date.getUTCDate() === 1,
  };
}

export function timelineMonthGroups(ticks: readonly TimelineDayTick[]): TimelineMonthGroup[] {
  const groups: TimelineMonthGroup[] = [];
  for (const tick of ticks) {
    const key = `${tick.date.getUTCFullYear()}-${tick.date.getUTCMonth()}`;
    const current = groups.at(-1);
    if (current?.key === key) {
      current.width += tick.width;
      current.dayCount += 1;
      continue;
    }
    groups.push({
      key,
      label: `Th ${tick.date.getUTCMonth() + 1}/${tick.date.getUTCFullYear()}`,
      left: tick.left,
      width: tick.width,
      dayCount: 1,
    });
  }
  return groups;
}
