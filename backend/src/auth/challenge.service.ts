import { randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import { AuthSecrets } from './credentials.js';
import { challengeId } from './input.js';
import { lockUser } from './session.service.js';

export type ChallengeKind = 'account_confirmation' | 'password_reset' | '2fa';
interface Challenge {
  id: string;
  kind: ChallengeKind;
  user_id: string | null;
  email: string | null;
  pending_name: string | null;
  pending_hash: string | null;
  issued_at: Date;
  expires_at: Date;
}
interface NewChallenge {
  userId?: string;
  email?: string;
  name?: string;
  passwordHash?: string;
  code?: string;
}
export function invalidChallenge(): never {
  throw new UnauthorizedException('Invalid or expired challenge.');
}

@Injectable()
export class Challenges {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuthSecrets) private readonly secrets: AuthSecrets,
  ) {}

  async create(
    client: { query(sql: string, values: unknown[]): Promise<unknown> },
    kind: ChallengeKind,
    data: NewChallenge,
  ) {
    const id = randomUUID();
    await client.query(
      `INSERT INTO auth_challenges (id, kind, user_id, email, pending_name, pending_hash, code_hash, expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()+$8::int*interval '1 minute')`,
      [
        id,
        kind,
        data.userId,
        data.email,
        data.name,
        data.passwordHash,
        data.code && this.secrets.codeHash(id, data.code),
        kind === '2fa' ? 10 : 15,
      ],
    );
    return id;
  }

  async info(id: string | undefined, kind: ChallengeKind) {
    const { rows } = await this.db.query<Challenge>(
      `SELECT id, kind, issued_at, expires_at FROM auth_challenges
      WHERE id=$1 AND kind=$2 AND expires_at>clock_timestamp()`,
      [challengeId(id), kind],
    );
    if (!rows[0]) invalidChallenge();
    return {
      id: rows[0].id,
      type: kind,
      issuedAt: rows[0].issued_at.getTime(),
      expiresAt: rows[0].expires_at.getTime(),
    };
  }

  async verifyReset(id: string | undefined, code: string) {
    const uuid = challengeId(id);
    const { rowCount } = await this.db.query(
      `SELECT 1 FROM auth_challenges WHERE id=$1 AND kind='password_reset'
      AND code_hash=$2 AND expires_at>clock_timestamp() AND user_id IS NOT NULL`,
      [uuid, this.secrets.codeHash(uuid, code)],
    );
    if (!rowCount) invalidChallenge();
    return { challengeId: uuid, type: 'password_reset' };
  }

  async consume(
    client: PoolClient,
    id: string | undefined,
    kind: ChallengeKind,
    code?: string,
  ) {
    const uuid = challengeId(id);
    // Acquire the account lock before its challenge to serialize password changes and sign-ins.
    const lookup = await client.query<{ user_id: string | null }>(
      'SELECT user_id FROM auth_challenges WHERE id=$1 AND kind=$2',
      [uuid, kind],
    );
    if (!lookup.rows[0]) invalidChallenge();
    const user = lookup.rows[0].user_id
      ? await lockUser(client, lookup.rows[0].user_id)
      : undefined;
    const { rows } = await client.query<Challenge>(
      `DELETE FROM auth_challenges WHERE id=$1 AND kind=$2
      AND expires_at>clock_timestamp() AND code_hash IS NOT DISTINCT FROM $3 RETURNING *`,
      [uuid, kind, code ? this.secrets.codeHash(uuid, code) : null],
    );
    if (!rows[0]) invalidChallenge();
    return { challenge: rows[0], user };
  }
}
