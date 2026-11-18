import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TOTP } from 'otpauth';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { Express } from 'express';
import { AppModule } from '../src/app.module.js';
import { AuthMail } from '../src/auth/auth-mail.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { readPostgresConfig } from '../src/database/database.config.js';
import { loadBackendEnv } from '../src/environment.js';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}
const first = 'alice@example.test';
const second = 'bob@example.test';
const password = 'Initial-1234!';
const replacement = 'Changed-1234!';
const reset = 'Recovered-1234!';
const prefix = '/api/v1/';
const schema = 'auth_test_' + randomUUID().replaceAll('-', '');
const outbox = new Map<string, string>();

describe.runIf(process.env.AUTH_TEST_POSTGRES === '1')(
  'first-party authentication over HTTP and PostgreSQL',
  () => {
    let admin: Pool;
    let pool: Pool;
    let app: INestApplication<App>;
    let server: App;
    beforeAll(async () => {
      loadBackendEnv();
      const pg = readPostgresConfig(process.env);
      admin = new Pool(pg);
      await admin.query('CREATE SCHEMA ' + schema);
      pool = new Pool({ ...pg, options: '-c search_path=' + schema });
      const sql = await readFile(
        new URL('../migrations/001_first_party_auth.sql', import.meta.url),
        'utf8',
      );
      await pool.query(sql);
      vi.stubEnv('AUTH_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
      const fixture = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DatabaseService)
        .useValue(new DatabaseService(pool))
        .overrideProvider(AuthMail)
        .useValue({
          send: (to: string, _kind: string, code: string) => {
            outbox.set(to, code);
            return Promise.resolve();
          },
        })
        .compile();
      app = fixture.createNestApplication();
      // Simulate a trusted loopback ingress to exercise independent source-IP and mailbox limits.
      const express: Express = app.getHttpAdapter().getInstance();
      express.set('trust proxy', 'loopback');
      await app.listen(0, '127.0.0.1');
      server = app.getHttpServer();
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      if (app) await app.close();
      else if (pool) await pool.end();
      if (admin) {
        try {
          await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
        } finally {
          await admin.end();
        }
      }
    });
    beforeEach(async () => {
      await pool.query(
        'TRUNCATE auth_challenges, auth_sessions, auth_users, auth_rate_limits',
      );
      outbox.clear();
    });

    const post = (path: string) => request(server).post(prefix + path);
    const get = (path: string) => request(server).get(prefix + path);
    const signIn = (email: string, pw: string) =>
      post('auth/sign-in').send({ email, password: pw });
    const session = (token: string) =>
      get('auth/session').auth(token, { type: 'bearer' });
    const rotate = (token: string) =>
      post('auth/refresh').auth(token, { type: 'bearer' });
    async function register(email: string): Promise<Tokens> {
      const pending = await post('auth/sign-up')
        .send({ name: 'Example', email, password })
        .expect(201);
      const pendingId = pending.body.challengeId as string;
      const code = outbox.get(email);
      expect(code).toMatch(/^\d{6}$/);
      const path = 'auth/verify-email/' + code;
      const confirmed = await post(path)
        .set('x-challenge-id', pendingId.toUpperCase())
        .expect(201);
      await post(path).set('x-challenge-id', pendingId).expect(401);
      return confirmed.body as Tokens;
    }

    it('rotates concurrent refreshes exactly once and revokes all credentials on password change and reset', async () => {
      const a = await register(first);
      const b = await register(second);
      await get('auth/session').expect(401);
      await session(a.refreshToken).expect(401);
      await rotate(a.accessToken).expect(401);
      const login = (await signIn(first, password).expect(200)).body as Tokens;
      const pair = await Promise.all([
        rotate(a.refreshToken),
        rotate(a.refreshToken),
      ]);
      expect(pair.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 401,
      ]);
      const next = pair.find((r) => r.status === 201)!.body as Tokens;
      await session(a.accessToken).expect(401);
      const change = (currentPassword: string) =>
        request(server)
          .put(prefix + 'account/profile/password')
          .auth(next.accessToken, { type: 'bearer' })
          .send({ currentPassword, newPassword: replacement });
      await change('wrong').expect(400);
      await change(password).expect(200);
      await session(next.accessToken).expect(401);
      await rotate(login.refreshToken).expect(401);
      await signIn(first, password).expect(401);
      const beforeReset = (await signIn(first, replacement).expect(200))
        .body as Tokens;
      const anonymous = await post('auth/forgot-password')
        .send({ email: 'missing@example.test' })
        .expect(201);
      const recovery = await post('auth/forgot-password')
        .send({ email: first })
        .expect(201);
      expect(Object.keys(anonymous.body).sort()).toEqual(
        Object.keys(recovery.body).sort(),
      );
      expect(anonymous.body.id).toEqual(expect.any(String));
      const id = recovery.body.id as string;
      const token = outbox.get(first);
      await get('auth/reset-password/verify/' + token)
        .set('x-challenge-id', id)
        .expect(200);
      await post('auth/reset-password/' + token)
        .set('x-challenge-id', id)
        .send({ password: reset })
        .expect(201);
      await post('auth/reset-password/' + token)
        .set('x-challenge-id', id)
        .send({ password: replacement })
        .expect(401);
      await session(beforeReset.accessToken).expect(401);
      await rotate(beforeReset.refreshToken).expect(401);
      const after = (await signIn(first, reset).expect(200)).body as Tokens;
      await post('auth/logout')
        .auth(after.accessToken, { type: 'bearer' })
        .expect(201);
      await session(after.accessToken).expect(401);
      await rotate(after.refreshToken).expect(401);
      expect((await session(b.accessToken).expect(200)).body.user.email).toBe(
        second,
      );
    }, 30000);

    it('isolates profile and session management, enforces setup, TOTP replay protection and password challenge revocation', async () => {
      const a = await register(first);
      const b = await register(second);
      const acct = (path: string) =>
        post('account/' + path).auth(a.accessToken, { type: 'bearer' });
      const otherSession = (await session(b.accessToken)).body.id as string;
      await request(server)
        .delete(prefix + 'account/sessions/' + otherSession)
        .auth(a.accessToken, { type: 'bearer' })
        .expect(404);
      await request(server)
        .put(prefix + 'account/profile')
        .auth(a.accessToken, { type: 'bearer' })
        .send({ name: 'Alice' })
        .expect(200);
      expect((await session(a.accessToken)).body.user.name).toBe('Alice');
      const setup = await acct('2fa/enable').expect(201);
      expect(setup.body.qrCode).toMatch(/^data:image\/png;base64,/);
      const totp = new TOTP({ secret: setup.body.secret as string });
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      try {
        const code = totp.generate({ timestamp: now });
        await acct('2fa/verify/' + code).expect(201);
        const pending = (await signIn(first, password).expect(200)).body;
        expect(pending.requiresTwoFactor).toBe(true);
        const id = pending.challengeId as string;
        await post('auth/2fa/sign-in/' + code)
          .set('x-challenge-id', id)
          .expect(401);
        const nextCode = totp.generate({ timestamp: now + 30000 });
        await post('auth/2fa/sign-in/' + nextCode)
          .set('x-challenge-id', id)
          .expect(200);
        await post('auth/2fa/sign-in/' + nextCode)
          .set('x-challenge-id', id)
          .expect(401);
        const stale = (await signIn(first, password).expect(200)).body
          .challengeId as string;
        await request(server)
          .put(prefix + 'account/profile/password')
          .auth(a.accessToken, { type: 'bearer' })
          .send({ currentPassword: password, newPassword: replacement })
          .expect(200);
        await get('auth/2fa/challenge')
          .set('x-challenge-id', stale)
          .expect(401);
        clock.mockReturnValue(now + 60000);
        const subsequent = (await signIn(first, replacement).expect(200)).body
          .challengeId as string;
        const fresh = await post(
          'auth/2fa/sign-in/' + totp.generate({ timestamp: now + 60000 }),
        )
          .set('x-challenge-id', subsequent)
          .expect(200);
        await post(
          'account/2fa/disable/' + totp.generate({ timestamp: now + 90000 }),
        )
          .auth(fresh.body.accessToken as string, { type: 'bearer' })
          .expect(201);
        await signIn(first, replacement)
          .expect(200)
          .expect((response) => expect(response.body.accessToken).toBeTruthy());
      } finally {
        clock.mockRestore();
      }
    }, 30000);

    it('enforces route limits, validity windows and single-mailbox input', async () => {
      await post('auth/sign-up')
        .send({ name: 'A', email: 'Alice<a@example.com>', password })
        .expect(400);
      const a = await register(first);
      await pool.query(
        "UPDATE auth_sessions SET access_expires_at=now()-interval '1 second', expires_at=now()-interval '1 second'",
      );
      await session(a.accessToken).expect(401);
      await rotate(a.refreshToken).expect(401);
      const pending = (
        await post('auth/forgot-password').send({ email: first })
      ).body.id as string;
      await pool.query(
        "UPDATE auth_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",
        [pending],
      );
      await get('auth/reset-password/verify/' + outbox.get(first))
        .set('x-challenge-id', pending)
        .expect(401);
      for (let n = 0; n < 5; n++) await signIn(first, 'wrong').expect(401);
      await signIn(first, password).expect(429);
    }, 30000);

    it('shares the recovery mailbox budget across source IPs and email casing', async () => {
      for (let n = 1; n <= 4; n++) {
        await post('auth/forgot-password')
          .set('X-Forwarded-For', '192.0.2.' + n)
          .send({ email: n % 2 ? first : first.toUpperCase() })
          .expect(n === 4 ? 429 : 201);
      }
      await post('auth/forgot-password')
        .set('X-Forwarded-For', '192.0.2.4')
        .send({ email: second })
        .expect(201);
    });
  },
);
