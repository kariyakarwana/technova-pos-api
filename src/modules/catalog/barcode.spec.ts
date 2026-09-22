import { createInternalBarcode } from './barcode';

describe('createInternalBarcode', () => {
  it('creates a compact Code 128 compatible value', () => {
    expect(createInternalBarcode(1_700_000_000_000, 'a1b2c3d4e5')).toMatch(
      /^TN[A-Z0-9]+$/,
    );
  });

  it('uses entropy to avoid duplicate values generated together', () => {
    expect(createInternalBarcode(100, 'aaaaaaaaaa')).not.toBe(
      createInternalBarcode(100, 'bbbbbbbbbb'),
    );
  });
});
