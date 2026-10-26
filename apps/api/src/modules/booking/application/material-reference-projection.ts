/** Redact linked Material content in Booking outputs, including effective snapshots and revision history.
 * Standalone URLs entered in Booking (without a Material reference) remain Booking data.
 * Never pass this read projection back into persistence. */
export function projectMaterialReferences<T>(value: T, visibleIds: ReadonlySet<string>): T {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    const record = item as Record<string, unknown>;
    const hidden = typeof record.materialId === 'string' && !visibleIds.has(record.materialId);
    return Object.fromEntries(Object.entries(record).map(([key, content]) => [
      key, hidden && ['materialId', 'materialUrl', 'materialName'].includes(key) ? null : visit(content),
    ]));
  };
  return visit(value) as T;
}
