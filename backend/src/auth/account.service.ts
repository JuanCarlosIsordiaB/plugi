import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Sessions, profile, type UserRow } from './session.service.js';

export interface ProfileUpdate {
  name?: string;
  lastName?: string;
  avatar?: string;
  country?: string;
  language?: string;
}

@Injectable()
export class Accounts {
  constructor(@Inject(Sessions) private readonly sessions: Sessions) {}

  profile(header?: string) {
    return this.sessions.authenticated(header, (_client, user) =>
      profile(user),
    );
  }

  update(header: string | undefined, data: ProfileUpdate) {
    return this.sessions.authenticated(header, async (client, user) => {
      const { rows } = await client.query<UserRow>(
        `UPDATE auth_users SET name=COALESCE($2,name),
        last_name=COALESCE($3,last_name), avatar=COALESCE($4,avatar), country=COALESCE($5,country),
        language=COALESCE($6,language), updated_at=now() WHERE id=$1 RETURNING *`,
        [
          user.id,
          data.name,
          data.lastName,
          data.avatar,
          data.country,
          data.language,
        ],
      );
      return profile(rows[0]);
    });
  }

  list(header?: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      const { rows } = await client.query(
        `SELECT id, user_id AS "userId", user_agent AS "userAgent",
        created_at AS "createdAt", last_used_at AS "lastUsedAt" FROM auth_sessions
        WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC`,
        [user.id],
      );
      return rows;
    });
  }

  remove(header: string | undefined, sessionId?: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      const { rowCount } = await client.query(
        'DELETE FROM auth_sessions WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2)',
        [user.id, sessionId],
      );
      if (sessionId && !rowCount)
        throw new NotFoundException('Session not found.');
      return { count: rowCount };
    });
  }
}
