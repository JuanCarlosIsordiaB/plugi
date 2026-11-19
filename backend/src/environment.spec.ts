import { readLocalWebCors } from './environment.js';

describe('local web CORS configuration', () => {
  it('disables CORS by default and in production', () => {
    expect(readLocalWebCors({})).toBe(false);
    expect(
      readLocalWebCors({
        WEB_ORIGIN: 'http://localhost:8081',
        NODE_ENV: 'production',
      }),
    ).toBe(false);
  });

  it.each([
    '*',
    'https://localhost:8081',
    'http://localhost.example:8081',
    'http://localhost:8081/path',
    'http://user@localhost:8081',
  ])('rejects invalid WEB_ORIGIN %s', (origin) => {
    expect(() => readLocalWebCors({ WEB_ORIGIN: origin })).toThrow(
      'WEB_ORIGIN',
    );
  });
});
