import { describe, expect, it } from 'vitest';
import { timelineColumnRevealScrollLeft, timelineDayHeader, timelineMonthGroups } from './campaign-timeline';

describe('Campaign day timeline headers', () => {
  it('uses compact Vietnamese day and weekday labels with a full tooltip', () => {
    const header = timelineDayHeader(new Date(Date.UTC(2026, 8, 1)));
    expect(header).toMatchObject({ day: '01', weekday: 'T3', tooltip: 'Thứ Ba, 01/09/2026', isWeekend: false, isMonthStart: true });
  });

  it('groups month spans accurately across leap-day and month boundaries', () => {
    const dates = [
      new Date(Date.UTC(2028, 1, 28)),
      new Date(Date.UTC(2028, 1, 29)),
      new Date(Date.UTC(2028, 2, 1)),
    ];
    const groups = timelineMonthGroups(dates.map((date, index) => ({ date, left: index * 46, width: 46 })));
    expect(groups).toEqual([
      { key: '2028-1', label: 'Th 2/2028', left: 0, width: 92, dayCount: 2 },
      { key: '2028-2', label: 'Th 3/2028', left: 92, width: 46, dayCount: 1 },
    ]);
    expect(timelineDayHeader(dates[1]!).day).toBe('29');
  });

  it('marks Saturday and Sunday without changing weekday order', () => {
    expect(timelineDayHeader(new Date(Date.UTC(2026, 8, 5))).weekday).toBe('T7');
    expect(timelineDayHeader(new Date(Date.UTC(2026, 8, 5))).isWeekend).toBe(true);
    expect(timelineDayHeader(new Date(Date.UTC(2026, 8, 6))).weekday).toBe('CN');
  });
});

describe('Campaign Timeline information columns', () => {
  it('reveals a newly enabled column beyond the left pane while leaving room for its pinned key', () => {
    expect(timelineColumnRevealScrollLeft({
      currentScrollLeft: 0, viewportWidth: 582, contentWidth: 1871,
      columnLeft: 1084, columnWidth: 220, pinnedWidth: 238,
    })).toBe(834);
  });

  it('does not move a column already visible and clamps the final column to the scroll limit', () => {
    expect(timelineColumnRevealScrollLeft({
      currentScrollLeft: 300, viewportWidth: 582, contentWidth: 1871,
      columnLeft: 600, columnWidth: 180, pinnedWidth: 238,
    })).toBe(300);
    expect(timelineColumnRevealScrollLeft({
      currentScrollLeft: 0, viewportWidth: 582, contentWidth: 1500,
      columnLeft: 1350, columnWidth: 150, pinnedWidth: 238,
    })).toBe(918);
  });
});
