import { generateSignedResourceToken, verifySignedResourceToken } from './signed-token';
describe('public receipt signatures', () => {
  const key = 'local-test-signing-key-32-characters-minimum';
  it('binds a valid token to the receipt and tenant', () => {
    const token = generateSignedResourceToken('receipt-a','tenant-a',key);
    expect(verifySignedResourceToken('receipt-a','tenant-a',token,key)).toBe(true);
    expect(verifySignedResourceToken('receipt-b','tenant-a',token,key)).toBe(false);
    expect(verifySignedResourceToken('receipt-a','tenant-b',token,key)).toBe(false);
    expect(verifySignedResourceToken('receipt-a','tenant-a',token+'0',key)).toBe(false);
  });
  it('rejects expired and old-key tokens and missing signing configuration', () => {
    const token = generateSignedResourceToken('r','t',key,Math.floor(Date.now()/1000)-1);
    expect(verifySignedResourceToken('r','t',token,key)).toBe(false);
    const current = generateSignedResourceToken('r','t',key);
    expect(verifySignedResourceToken('r','t',current,key+'rotated')).toBe(false);
    expect(() => generateSignedResourceToken('r','t','default')).toThrow();
  });
});
