import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import { bearer, digest } from './credentials.js';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  last_name: string | null;
  avatar: string | null;
  country: string | null;
  language: string | null;
  password_hash: string;
  is_admin: boolean;
  totp_enabled: boolean;
  totp_secret: string | null;
  totp_last_step: string | null;
  totp_setup_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
export function profile(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    lastName: user.last_name,
    email: user.email,
    avatar: user.avatar,
    country: user.country,
    language: user.language,
    emailConfirm: true,
    twoFactorEnabled: user.totp_enabled,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}
function freshTokens() {
  return {
    accessToken: randomBytes(32).toString('base64url'),
    refreshToken: randomBytes(32).toString('base64url'),
  };
}
export async function lockUser(
  client: PoolClient,
  id: string,
): Promise<UserRow> {
  const { rows } = await client.query<UserRow>(
    'SELECT * FROM auth_users WHERE id=$1 FOR NO KEY UPDATE',
    [id],
  );
  if (!rows[0]) throw new UnauthorizedException('Account unavailable.');
  return rows[0];
}

export interface SessionInfo {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
}

@Injectable()
export class Sessions {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async issue(client: PoolClient, userId: string, agent?: string) {
    const tokens = freshTokens();
    await client.query(
      `INSERT INTO auth_sessions
      (id,user_id,access_hash,refresh_hash,access_expires_at,expires_at,user_agent)
      VALUES ($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '7 days',$5)`,
      [
        randomUUID(),
        userId,
        digest(tokens.accessToken),
        digest(tokens.refreshToken),
        agent?.slice(0, 512),
      ],
    );
    return tokens;
  }

  async refresh(header?: string) {
    const previous = digest(bearer(header));
    const tokens = freshTokens();
    const { rowCount } = await this.db.query(
      `UPDATE auth_sessions SET
        access_hash=$2, refresh_hash=$3, last_used_at=now(),
        access_expires_at=LEAST(now()+interval '15 minutes',expires_at)
      WHERE refresh_hash=$1 AND expires_at>clock_timestamp()`,
      [previous, digest(tokens.accessToken), digest(tokens.refreshToken)],
    );
    if (!rowCount)
      throw new UnauthorizedException('Invalid or expired refresh token.');
    return tokens;
  }

  async authenticated<T>(
    header: string | undefined,
    work: (
      client: PoolClient,
      user: UserRow,
      session: SessionInfo,
    ) => Promise<T> | T,
  ): Promise<T> {
    const hash = digest(bearer(header));
    return this.db.transaction(async (client) => {
      const found = await client.query<{ user_id: string }>(
        'SELECT user_id FROM auth_sessions WHERE access_hash=$1',
        [hash],
      );
      if (!found.rows[0])
        throw new UnauthorizedException('Invalid or expired access token.');
      const user = await lockUser(client, found.rows[0].user_id);
      const { rows } = await client.query<SessionInfo>(
        `SELECT id, created_at AS "createdAt", last_used_at AS "lastUsedAt"
        FROM auth_sessions WHERE user_id=$1 AND access_hash=$2 AND access_expires_at>clock_timestamp() FOR UPDATE`,
        [user.id, hash],
      );
      if (!rows[0])
        throw new UnauthorizedException('Invalid or expired access token.');
      return work(client, user, rows[0]);
    });
  }

  current(header?: string) {
    return this.authenticated(header, (_client, user, session) => ({
      ...session,
      user: profile(user),
    }));
  }

  logout(header?: string) {
    return this.authenticated(header, async (client, _user, session) => {
      await client.query('DELETE FROM auth_sessions WHERE id=$1', [session.id]);
      return { msg: 'Signed out.' };
    });
  }
}
