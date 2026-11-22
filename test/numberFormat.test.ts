import { readTypedAmount, toTypedAmount } from "../src/utils/numberFormat";

const read = (text: string, format: 'en-US' | 'de-DE', wholeOnly = false) => readTypedAmount(text, wholeOnly, format);

describe('readTypedAmount', () => {
  it('takes a dot or a comma as the decimal mark in any format', () => {
    for (const format of ['en-US', 'de-DE'] as const) {
      expect(read('0,125', format)).toEqual({ amount: '0.125' });
      expect(read('1,5', format)).toEqual({ amount: '1.5' });
      expect(read('12.50', format)).toEqual({ amount: '12.50' });
      expect(read('1.00000', format)).toEqual({ amount: '1.00000' });
      expect(read(' .5 ', format)).toEqual({ amount: '.5' });
      expect(read('5.', format)).toEqual({ amount: '5.' });
    }
  })

  // a thousand to one region, one to the other: only the format's own decimal mark is taken
  it('reads the ambiguous shape only with the format\'s decimal mark', () => {
    expect(read('1.000', 'en-US')).toEqual({ amount: '1.000' });
    expect(read('1,000', 'en-US')).toEqual({ problem: 'ambiguous' });
    expect(read('1,000', 'de-DE')).toEqual({ amount: '1.000' });
    expect(read('1.000', 'de-DE')).toEqual({ problem: 'ambiguous' });
    expect(read('250,000', 'en-US')).toEqual({ problem: 'ambiguous' });
    expect(read('0,125', 'en-US')).toEqual({ amount: '0.125' });
    expect(read('1000,000', 'en-US')).toEqual({ amount: '1000.000' });
  })

  it('refuses grouping and anything but ASCII digits', () => {
    for (const input of ['1,234.5', '1.234,5', '1 234', '1 234', '1 234', "1'234", '1’234']) {
      expect(read(input, 'en-US')).toEqual({ problem: 'grouping' });
    }
    for (const input of ['', '.', ',', '-1', '1e5', '١٢', 'abc']) {
      expect(read(input, 'en-US')).toEqual({ problem: 'invalid' });
    }
  })

  // satoshis, 0-decimal tokens and counts: a separator there can only be grouping
  it('refuses any separator in a whole-number field', () => {
    expect(read('1.000', 'de-DE', true)).toEqual({ problem: 'wholeOnly' });
    expect(read('1.000', 'en-US', true)).toEqual({ problem: 'wholeOnly' });
    expect(read('1000', 'de-DE', true)).toEqual({ amount: '1000' });
  })
})

describe('toTypedAmount', () => {
  // what the app fills in must read back as it was meant, so it uses the mark the user types
  it('writes the format\'s decimal mark, which reads back unambiguously', () => {
    expect(toTypedAmount('1.5', 'de-DE')).toBe('1,5');
    expect(read(toTypedAmount('1.500', 'de-DE'), 'de-DE')).toEqual({ amount: '1.500' });
    expect(toTypedAmount('1.500', 'en-US')).toBe('1.500');
    expect(toTypedAmount('1000', 'de-DE')).toBe('1000');
  })
})
