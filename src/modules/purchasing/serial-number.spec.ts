import { generateInventorySerialNumber } from './serial-number';

describe('generateInventorySerialNumber', () => {
  it('creates a readable SKU-prefixed serial number', () => {
    expect(
      generateInventorySerialNumber(
        ' lap pro / 15 ',
        new Date('2026-09-08T00:00:00.000Z'),
        '12345678-abcd-4000-8000-000000000000',
      ),
    ).toBe('LAP-PRO-15-20260908-12345678AB');
  });

  it('uses a safe fallback for punctuation-only SKUs', () => {
    expect(
      generateInventorySerialNumber(
        '---',
        new Date('2026-01-02T00:00:00.000Z'),
        'abcdef1234-0000-0000-0000-000000000000',
      ),
    ).toBe('ITEM-20260102-ABCDEF1234');
  });
});
