import { emailField, newPassword } from './input.js';

describe('authentication input', () => {
  it('normalizes a single bare mailbox', () => {
    expect(emailField(' Alice+Work@Example.COM ')).toBe(
      'alice+work@example.com',
    );
  });
  it.each([
    'Alice<a@example.com>',
    'a@example.com,b@example.net',
    '.alice@example.com',
    'a@b..example.com',
    'a@-host.example',
    'a@example.com\r\nBcc: x@example.org',
    null,
  ])('rejects malformed mailbox %s', (input) => {
    expect(() => emailField(input)).toThrow();
  });
  it('preserves the exact password and rejects weak input', () => {
    expect(newPassword(' Abcd1234! ')).toBe(' Abcd1234! ');
    expect(() => newPassword('alllowercase')).toThrow();
  });
});
