import {describe,expect,it} from 'vitest';
import {bookingProduct,bookingSum} from './booking-money';
describe('booking currency previews',()=>{
  it('adds mixed unit prices and VAT without the observed binary floating-point tail',()=>{expect(bookingSum(['14040000','10028571.12'])).toBe('24068571.120000');});
  it('keeps large decimal quantities exact and rounds half up at the server monetary scale',()=>{expect(bookingProduct('9007199254740993','0.000001')).toBe('9007199254.740993');expect(bookingProduct('0.123456789','100')).toBe('12.345679');expect(bookingProduct('12.345679','0.08')).toBe('0.987654');});
  it('honors explicit price basis and preserves ten decimal quantity digits in totals',()=>{expect(bookingProduct('1234','100','1000')).toBe('123.400000');expect(bookingSum(['0.0000000001','0.0000000002'],10)).toBe('0.0000000003');});
});
