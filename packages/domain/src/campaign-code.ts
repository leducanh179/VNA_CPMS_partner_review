const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORBIDDEN_DIGIT_PAIRS = [[7, 8], [4, 9], [5, 3]] as const;
const ALLOWED_DIGIT_PAIRS = Array.from({ length: 10 }, (_, first) =>
  Array.from({ length: 10 }, (_, last) => [first, last] as const),
).flat().filter(([first, last]) => last !== 4 && !FORBIDDEN_DIGIT_PAIRS.some(([a, b]) =>
  (first === a && last === b) || (first === b && last === a)));

/** The restrictions apply to the four-character random suffix, not YYYYMM. */
export function isCampaignCodeCompliant(code: string): boolean {
  const suffix = /^CPG-\d{6}-([A-Z0-9]{4})$/.exec(code)?.[1];
  if (!suffix || !/^(?:[A-Z]\d[A-Z]\d|\d[A-Z]\d[A-Z])$/.test(suffix) || suffix.endsWith('4')) return false;
  const digits = [...suffix].filter((character) => /\d/.test(character)).map(Number);
  return !FORBIDDEN_DIGIT_PAIRS.some(([a, b]) => digits.includes(a) && digits.includes(b));
}

/** Caller supplies a cryptographically secure draw(maxExclusive). */
export function createCampaignCodeCandidate(now: Date, draw: (maxExclusive: number) => number): string {
  const yearMonth = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const pair = ALLOWED_DIGIT_PAIRS[draw(ALLOWED_DIGIT_PAIRS.length)];
  if (!pair) throw new Error('Invalid Campaign code random draw.');
  const [first, last] = pair;
  const left = LETTERS[draw(LETTERS.length)];
  const right = LETTERS[draw(LETTERS.length)];
  const suffix = draw(2) === 0 ? `${left}${first}${right}${last}` : `${first}${left}${last}${right}`;
  return `CPG-${yearMonth}-${suffix}`;
}

export function createCampaignCodeCandidateForPrefix(prefix: string, draw: (maxExclusive: number) => number): string {
  if (!/^CPG-\d{6}$/.test(prefix)) throw new Error('Invalid Campaign code prefix.');
  const generated = createCampaignCodeCandidate(new Date('2000-01-01T00:00:00.000Z'), draw);
  return `${prefix}-${generated.slice(-4)}`;
}
