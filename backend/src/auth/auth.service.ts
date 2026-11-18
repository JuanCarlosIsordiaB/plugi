import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import { AuthMail } from './auth-mail.service.js';
import { Challenges, invalidChallenge } from './challenge.service.js';
import { hashPassword, matchesPassword } from './credentials.js';
import { lockUser, Sessions, type UserRow } from './session.service.js';
import { TotpService } from './totp.service.js';

async function replacePassword(client: PoolClient, id: string, hash: string) {
  await client.query(
    `UPDATE auth_users SET password_hash=$2, updated_at=now(),
    totp_secret=CASE WHEN totp_enabled THEN totp_secret ELSE NULL END, totp_setup_expires_at=NULL WHERE id=$1`,
    [id, hash],
  );
  await client.query('DELETE FROM auth_sessions WHERE user_id=$1', [id]);
  await client.query('DELETE FROM auth_challenges WHERE user_id=$1', [id]);
}
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(Sessions) private readonly sessions: Sessions,
    @Inject(Challenges) private readonly challenges: Challenges,
    @Inject(TotpService) private readonly totp: TotpService,
    @Inject(AuthMail) private readonly mail: AuthMail,
  ) {}

  async signup(name: string, email: string, password: string) {
    const existing = await this.db.query(
      'SELECT 1 FROM auth_users WHERE email=$1',
      [email],
    );
    if (existing.rowCount)
      throw new ConflictException('Email is already registered.');
    const code = randomInt(1_000_000).toString().padStart(6, '0');
    const challengeId = await this.challenges.create(
      this.db,
      'account_confirmation',
      {
        email,
        name,
        passwordHash: await hashPassword(password),
        code,
      },
    );
    try {
      await this.mail.send(email, 'account_confirmation', code);
    } catch (error) {
      await this.db.query('DELETE FROM auth_challenges WHERE id=$1', [
        challengeId,
      ]);
      throw error;
    }
    return { challengeId };
  }

  verifyEmail(id: string | undefined, code: string, agent?: string) {
    return this.db.transaction(async (client) => {
      const { challenge } = await this.challenges.consume(
        client,
        id,
        'account_confirmation',
        code,
      );
      const userId = randomUUID();
      const result = await client.query(
        `INSERT INTO auth_users(id,name,email,password_hash)
        VALUES($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING`,
        [
          userId,
          challenge.pending_name,
          challenge.email,
          challenge.pending_hash,
        ],
      );
      if (!result.rowCount)
        throw new ConflictException('Email is already registered.');
      return this.sessions.issue(client, userId, agent);
    });
  }

  async signIn(email: string, password: string, agent?: string) {
    const { rows } = await this.db.query<Pick<UserRow, 'id' | 'password_hash'>>(
      'SELECT id,password_hash FROM auth_users WHERE email=$1',
      [email],
    );
    const initial = rows[0];
    if (!(await matchesPassword(password, initial?.password_hash)) || !initial)
      throw new UnauthorizedException('Invalid email or password.');
    return this.db.transaction(async (client) => {
      const user = await lockUser(client, initial.id);
      if (initial.password_hash !== user.password_hash)
        throw new UnauthorizedException('Invalid email or password.');
      if (!user.totp_enabled)
        return this.sessions.issue(client, user.id, agent);
      const challengeId = await this.challenges.create(client, '2fa', {
        userId: user.id,
      });
      return { requiresTwoFactor: true, challengeId };
    });
  }

  secondFactor(id: string | undefined, code: string, agent?: string) {
    return this.db.transaction(async (client) => {
      const { user } = await this.challenges.consume(client, id, '2fa');
      if (!user?.totp_enabled) invalidChallenge();
      await this.totp.accept(client, user, code);
      return this.sessions.issue(client, user.id, agent);
    });
  }

  async forgot(email: string) {
    const token = randomBytes(32).toString('hex');
    const { id, known } = await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'SELECT id FROM auth_users WHERE email=$1 FOR UPDATE',
        [email],
      );
      const userId = rows[0]?.id;
      return {
        id: await this.challenges.create(client, 'password_reset', {
          userId,
          code: token,
        }),
        known: !!userId,
      };
    });
    if (known) {
      // The public recovery response must have the same shape and must not wait on the provider for registered accounts.
      void this.mail.send(email, 'password_reset', token).catch(() => {
        this.logger.error('Password recovery email delivery failed.');
      });
    }
    return { id, type: 'password_reset' };
  }

  resetPassword(id: string | undefined, token: string, password: string) {
    return this.db.transaction(async (client) => {
      const { user } = await this.challenges.consume(
        client,
        id,
        'password_reset',
        token,
      );
      if (!user) invalidChallenge();
      await replacePassword(client, user.id, await hashPassword(password));
      return user.id;
    });
  }

  changePassword(header: string | undefined, current: string, next: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      if (!(await matchesPassword(current, user.password_hash)))
        throw new BadRequestException('Current password is incorrect.');
      await replacePassword(client, user.id, await hashPassword(next));
      return { message: 'Password updated. Sign in again.', statusCode: 200 };
    });
  }
}
