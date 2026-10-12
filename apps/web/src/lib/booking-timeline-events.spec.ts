import { describe, expect, it } from 'vitest';
import { bookingSnapshot, type BookingListItem } from '@cpms/domain';
import { bookingCampaignColor, bookingTimelineEvents, timelineLocalDate } from './booking-timeline-events';

const row={id:'booking',startDate:'2026-09-20',endDate:'2026-09-30',quantity:'10',acceptedQty:'0',reportState:'EMPTY',deletedAt:null,execution:'NOT_STARTED',state:'ACTIVE',reportPeriods:[],campaignId:'campaign',campaignLabel:'Campaign'} as unknown as BookingListItem;
describe('Campaign Booking timeline evidence',()=>{
  it('uses effective schedule during amendment and actual handoff times',()=>{
    const b={...row,startDate:'2026-10-01',workflow:{version:1 as const,status:'PENDING_LEADER' as const,route:'MANAGER' as const,origin:'MANAGER' as const,required:true,policyVersion:1,requestVersion:1,submittedBy:'manager',submittedAt:'2026-09-15T00:00:00Z',reason:'',effective:bookingSnapshot(row),decisions:[{actorId:'vendor',step:'PENDING_VENDOR' as const,at:'2026-09-16T00:00:00Z',decision:'CONFIRM',reason:'',receivedAt:'2026-09-15T00:00:00Z'}]}};
    const events=bookingTimelineEvents(b,Date.parse('2026-09-16T12:00:00Z'));
    expect(events.schedule.startDate).toBe('2026-09-20');expect(events.start).toBe('2026-09-15');
    expect(events.tasks.find(t=>t.id==='booking-approval')?.dueAt).toBe('2026-09-17T00:00:00.000Z');
  });
  it('does not fabricate approval milestones for automatic bookings',()=>{
    expect(bookingTimelineEvents(row,Date.parse('2026-09-16')).tasks.filter(t=>t.kind==='APPROVAL')).toEqual([]);
    expect(timelineLocalDate('2026-09-16T18:00:00Z')).toBe('2026-09-17');
    expect(bookingCampaignColor('campaign')).toBe(bookingCampaignColor('campaign'));
  });
});
