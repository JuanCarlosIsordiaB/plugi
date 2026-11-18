import type { PoolConfig } from 'pg';

const requiredVariables = [
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
] as const;

export function readPostgresConfig(env: NodeJS.ProcessEnv): PoolConfig {
  const missing = requiredVariables.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing PostgreSQL configuration: ${missing.join(', ')}.`);
  }

  const port = Number(env.PGPORT);
  if (!/^\d+$/.test(env.PGPORT ?? '') || port < 1 || port > 65535) {
    throw new Error('PGPORT must be an integer from 1 to 65535.');
  }

  return {
    host: env.PGHOST,
    port,
    database: env.PGDATABASE,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    connectionTimeoutMillis: 5_000,
  };
}
