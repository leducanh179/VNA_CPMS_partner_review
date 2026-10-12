import { bookingDeadlines, bookingEffective, bookingExecutionAsOf, type BookingListItem } from '@cpms/domain';

export function timelineLocalDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value));
}
export function bookingTimelineEvents(row: BookingListItem, now: number) {
  const effective = bookingEffective(row), schedule = effective ?? row;
  const tasks = bookingDeadlines(row, now).filter(t => t.kind !== 'APPROVAL' || row.workflow?.required || row.workflow?.decisions.length || row.lifecycleRequest);
  const milestones = tasks.flatMap(task => [
    ...(task.receivedAt ? [{ id:`${task.id}:received`, at:task.receivedAt, label:`Nhận: ${task.label}`, task }] : []),
    ...(task.dueAt ? [{ id:`${task.id}:due`, at:task.dueAt, label:`Hạn: ${task.label}`, task }] : []),
    ...(task.completedAt ? [{ id:`${task.id}:completed`, at:task.completedAt, label:`Đã xử lý: ${task.label}`, task }] : []),
  ]);
  const bounds = [schedule.startDate, schedule.endDate, ...milestones.map(m => timelineLocalDate(m.at))].sort();
  return { schedule, effective:Boolean(effective), execution:bookingExecutionAsOf(row, new Date(now)), tasks, milestones, start:bounds[0]!, end:bounds.at(-1)! };
}
export function bookingCampaignColor(key: string) {
  let hash = 0; for (const c of key) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return ['#007f96','#7c3aed','#2563eb','#15803d','#b45309','#be185d'][Math.abs(hash) % 6]!;
}
