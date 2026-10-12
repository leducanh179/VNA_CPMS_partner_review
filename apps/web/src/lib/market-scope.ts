export interface MarketScopeOption { code: string; label: string }

export function marketScopeMatches(option: MarketScopeOption, query: string) {
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLocaleLowerCase('vi').trim();
  const needle = normalize(query);
  return !needle || normalize(`${option.code} ${option.label}`).includes(needle);
}

export function setVisibleMarketScopeSelection(selected: string[], visible: string[], checked: boolean) {
  const next = new Set(selected);
  for (const code of visible) {
    if (checked) next.add(code);
    else next.delete(code);
  }
  return [...next];
}
