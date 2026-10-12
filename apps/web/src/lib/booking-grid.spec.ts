import {describe,expect,it} from 'vitest';
import {bookingClipboardRows,bookingClipboardValue} from './booking-grid';
describe('booking clipboard',()=>{
  it('preserves TSV cell positions including locked and empty columns',()=>{expect(bookingClipboardRows('PC\t\t10\r\nMobile\t\t20\r\n')).toEqual([['PC','','10'],['Mobile','','20']]);});
  it('maps displayed dropdown labels to canonical ids and rejects ambiguous choices',()=>{const options=[{value:'pc',label:'Large 1 PC'},{value:'mobile',label:'Mobile'}];expect(bookingClipboardValue('large 1 pc',undefined,options)).toBe('pc');expect(bookingClipboardValue('mobile',undefined,options)).toBe('mobile');expect(()=>bookingClipboardValue('Unknown',undefined,options)).toThrow();expect(()=>bookingClipboardValue('Mobile',undefined,[...options,{value:'m2',label:'Mobile'}])).toThrow();});
  it('accepts Vietnamese dates and explicitly comma-decimal numbers',()=>{expect(bookingClipboardValue('12/9/2026','date')).toBe('2026-09-12');expect(bookingClipboardValue('1.234,50','number')).toBe('1234.50');});
  it('rejects clipboard batches above the shared limit',()=>{expect(()=>bookingClipboardRows(Array(51).fill('1').join('\n'))).toThrow('50 dòng');});
});
