import { readdir, readFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { loadBackendEnv } from '../environment.js';
import { DatabaseModule } from './database.module.js';
import { DatabaseService } from './database.service.js';

loadBackendEnv();
const app = await NestFactory.createApplicationContext(DatabaseModule, {
  logger: false,
});
try {
  const directory = new URL('../../migrations/', import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort();
  if (files.length === 0) throw new Error('No database migrations found.');
  await app.get(DatabaseService).transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('buscapila_migrations'))",
    );
    await client.query(
      'CREATE TABLE IF NOT EXISTS buscapila_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const file of files) {
      const name = file.slice(0, -4);
      const existing = await client.query(
        'SELECT 1 FROM buscapila_migrations WHERE name=$1',
        [name],
      );
      if (!existing.rowCount) {
        await client.query(await readFile(new URL(file, directory), 'utf8'));
        await client.query(
          'INSERT INTO buscapila_migrations(name) VALUES ($1)',
          [name],
        );
      }
    }
  });
  console.log('Database schema is up to date.');
} finally {
  await app.close();
}
