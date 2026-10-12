export function deriveHealthTone(connected: boolean): 'positive' | 'warning' {
  return connected ? 'positive' : 'warning';
}
