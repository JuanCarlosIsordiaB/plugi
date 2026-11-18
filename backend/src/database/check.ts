import { NestFactory } from '@nestjs/core';
import { loadBackendEnv } from '../environment.js';
import { DatabaseModule } from './database.module.js';

try {
  loadBackendEnv();
  const app = await NestFactory.createApplicationContext(DatabaseModule, {
    abortOnError: false,
    logger: false,
  });
  await app.close();
  console.log('PostgreSQL connection verified.');
} catch {
  console.error(
    'PostgreSQL check failed. Verify the backend PG settings and server status.',
  );
  process.exitCode = 1;
}
