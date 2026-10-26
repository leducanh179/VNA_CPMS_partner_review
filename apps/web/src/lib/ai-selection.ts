import { useSyncExternalStore } from 'react';
import type { LookupRecordRef } from '@cpms/ai-contracts';

export interface AiSelection {
  title: string; record?: LookupRecordRef | undefined; label?: string; fieldKey?: string; text?: string;
  readText?: () => string;
}
let selection: AiSelection | null = null;
const listeners = new Set<() => void>();
export function publishAiSelection(value: AiSelection | null) {
  selection = value; for (const listener of listeners) listener();
}
export function useAiSelection() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => selection);
}
export function selectedCellText(element: HTMLElement | null, fallback: string) {
  const editor = element?.querySelector('textarea,input:not([type=checkbox]),select,[contenteditable=true]');
  if (editor instanceof HTMLSelectElement) return editor.selectedOptions[0]?.textContent ?? editor.value;
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) return editor.value;
  return editor?.textContent ?? fallback;
}
export function aiRecordFromPath(path: string): LookupRecordRef | undefined {
  const match = path.match(/^\/(campaigns|contracts|materials)\/([0-9a-f-]{36})(?:\/edit)?$/i);
  if (!match) return undefined;
  return { kind: match[1] === 'campaigns' ? 'CAMPAIGN' : match[1] === 'contracts' ? 'CONTRACT' : 'MATERIAL', id: match[2]! };
}
