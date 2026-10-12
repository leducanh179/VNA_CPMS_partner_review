import { randomInt } from 'node:crypto';

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const digits = '0123456789';
const forbiddenPairs = [['7', '8'], ['4', '9'], ['5', '3']] as const;

export function isValidMaterialCode(value: string): boolean {
  if (!/^MTR-\d{4}(0[1-9]|1[0-2])-([A-Z]\d){3}$/.test(value)) return false;
  const suffix = value.slice(-6);
  const digitPart = `${suffix[1]}${suffix[3]}${suffix[5]}`;
  return !['4', '7'].includes(suffix[5]!) && forbiddenPairs.every(([left, right]) => !(digitPart.includes(left) && digitPart.includes(right)));
}

export function generateMaterialCode(now = new Date(), choose: (max: number) => number = randomInt): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!year || !month) throw new Error('Không xác định được năm/tháng tạo tư liệu.');
  let suffix = '';
  const chosenDigits: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    suffix += letters[choose(letters.length)];
    const options = [...digits].filter((digit) =>
      (index !== 2 || !['4', '7'].includes(digit))
      && forbiddenPairs.every(([left, right]) => !(digit === left && chosenDigits.includes(right)) && !(digit === right && chosenDigits.includes(left))));
    const digit = options[choose(options.length)]!;
    suffix += digit;
    chosenDigits.push(digit);
  }
  return `MTR-${year}${month}-${suffix}`;
}
