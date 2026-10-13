import { ValidationFailedError, etagOf, parseIfMatch } from '../../src/core';

describe('conditional requests: If-Match parsing', () => {
  it('round-trips the entity tag of a version', () => {
    expect(etagOf(7)).toBe('"v7"');
    expect(parseIfMatch(etagOf(7))).toBe(7);
  });

  it('accepts a weak validator and surrounding whitespace', () => {
    expect(parseIfMatch(' W/"v12" ')).toBe(12);
  });

  it('treats an absent header and "*" as "no precondition"', () => {
    expect(parseIfMatch(undefined)).toBeUndefined();
    expect(parseIfMatch('*')).toBeUndefined();
  });

  it.each(['v1', '"1"', '"v-1"', '"v1", "v2"', '"v12345678901"', ''])('rejects %j with a 400', (header) => {
    expect(() => parseIfMatch(header)).toThrow(ValidationFailedError);
  });
});
