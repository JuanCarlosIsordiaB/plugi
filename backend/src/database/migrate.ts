import { readFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { loadBackendEnv } from '../environment.js';
import { DatabaseModule } from './database.module.js';
import { DatabaseService } from './database.service.js';

loadBackendEnv();
const app = await NestFactory.createApplicationContext(DatabaseModule, {
  logger: false,
});
try {
  const sql = await readFile(
    new URL('../../migrations/001_first_party_auth.sql', import.meta.url),
    'utf8',
  );
  await app.get(DatabaseService).transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('buscapila_migrations'))",
    );
    await client.query(
      'CREATE TABLE IF NOT EXISTS buscapila_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const name = '001_first_party_auth';
    const existing = await client.query(
      'SELECT 1 FROM buscapila_migrations WHERE name=$1',
      [name],
    );
    if (!existing.rowCount) {
      await client.query(sql);
      await client.query('INSERT INTO buscapila_migrations(name) VALUES ($1)', [
        name,
      ]);
    }
  });
  console.log('Authentication schema is up to date.');
} finally {
  await app.close();
}
