import { NestFactory } from '@nestjs/core';
import { emailField } from '../auth/input.js';
import { loadBackendEnv } from '../environment.js';
import { DatabaseModule } from './database.module.js';
import { DatabaseService } from './database.service.js';

const [, , operation, address, ...extra] = process.argv;
if (extra.length || (operation !== 'grant' && operation !== 'revoke')) {
  throw new Error('Usage: npm run admin:role -- <grant|revoke> <email>');
}
const email = emailField(address);
loadBackendEnv();
const app = await NestFactory.createApplicationContext(DatabaseModule, {
  abortOnError: false,
  logger: false,
});

try {
  const result = await app.get(DatabaseService).query(
    'UPDATE auth_users SET is_admin=$2 WHERE email=$1',
    [email, operation === 'grant'],
  );
  if (!result.rowCount)
    throw new Error('No verified account matches that email address.');
  console.log('Administrator role updated.');
} finally {
  await app.close();
}
