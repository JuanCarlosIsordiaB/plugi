import { readPostgresConfig } from './database.config.js';

const validEnv = {
  PGHOST: 'localhost',
  PGPORT: '5432',
  PGDATABASE: 'test_db',
  PGUSER: 'test_user',
  PGPASSWORD: ' test password ',
};

describe('readPostgresConfig', () => {
  it('requires explicit settings and preserves the supplied password', () => {
    expect(readPostgresConfig(validEnv)).toEqual({
      host: 'localhost',
      port: 5432,
      database: 'test_db',
      user: 'test_user',
      password: ' test password ',
      connectionTimeoutMillis: 5_000,
    });
  });

  it.each(Object.keys(validEnv))('rejects a missing or blank %s', (name) => {
    for (const value of [undefined, '', '  ']) {
      expect(() => readPostgresConfig({ ...validEnv, [name]: value })).toThrow(
        `Missing PostgreSQL configuration: ${name}.`,
      );
    }
  });

  it.each(['0', '65536', '-1', '1.5', '1e3', '0x10', '5432x'])(
    'rejects an invalid PGPORT of %s',
    (PGPORT) => {
      expect(() => readPostgresConfig({ ...validEnv, PGPORT })).toThrow(
        'PGPORT must be an integer from 1 to 65535.',
      );
    },
  );
});
