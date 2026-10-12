import { useEffect } from 'react';

const blockers = new Set<symbol>();
const WARNING = 'Thay đổi của bạn chưa được lưu. Bạn có chắc chắn muốn rời đi?';

export function hasUnsavedChanges() {
  return blockers.size > 0;
}

export function confirmUnsavedNavigation() {
  return !hasUnsavedChanges() || window.confirm(WARNING);
}

export function useUnsavedChanges(active: boolean) {
  useEffect(() => {
    if (!active) return undefined;
    const token = Symbol('unsaved-change');
    blockers.add(token);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      blockers.delete(token);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [active]);
}
