import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Sessions } from '../auth/session.service.js';

@Injectable()
export class ContactModeration {
  constructor(@Inject(Sessions) private readonly sessions: Sessions) {}

  report(header: string | undefined, message: string, reason: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      // Only a visible message written by the other participant can be reported.
      const target = await client.query(
        `SELECT m.id FROM contact_messages m JOIN contact_conversations c ON c.id=m.conversation_id
         WHERE m.id=$1 AND NOT m.hidden AND
         ((c.recipient=$2 AND m.from_initiator) OR (c.initiator=$2 AND c.answered AND NOT m.from_initiator))`,
        [message, user.id],
      );
      if (!target.rowCount) throw new NotFoundException();
      await client.query(
        'INSERT INTO contact_reports(id,message_id,reporter,reason) VALUES ($1,$2,$3,$4) ON CONFLICT(message_id,reporter) DO NOTHING',
        [randomUUID(), message, user.id, reason],
      );
    });
  }
  queue(header?: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      if (!user.is_admin) throw new ForbiddenException();
      const result = await client.query<{
        id: string;
        message: string;
        reason: string;
        createdAt: Date;
      }>(
        `SELECT r.id,m.body AS message,r.reason,r.created_at AS "createdAt" FROM contact_reports r
         JOIN contact_messages m ON m.id=r.message_id WHERE r.resolution IS NULL ORDER BY r.created_at,r.id LIMIT 100`,
      );
      return { reports: result.rows };
    });
  }
  resolve(header: string | undefined, id: string, action: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      if (!user.is_admin) throw new ForbiddenException();
      const result = await client.query<{ message: string; author: string }>(
        `SELECT m.id AS message,CASE WHEN m.from_initiator THEN c.initiator ELSE c.recipient END AS author
         FROM contact_reports r JOIN contact_messages m ON m.id=r.message_id
         JOIN contact_conversations c ON c.id=m.conversation_id
         WHERE r.id=$1 AND r.resolution IS NULL FOR UPDATE OF r`,
        [id],
      );
      if (!result.rows[0]) throw new NotFoundException();
      const { message, author } = result.rows[0];
      if (action !== 'dismiss')
        await client.query(
          'UPDATE contact_messages SET hidden=true WHERE id=$1',
          [message],
        );
      if (action === 'suspend')
        await client.query(
          'INSERT INTO contact_suspensions(user_id) VALUES ($1) ON CONFLICT DO NOTHING',
          [author],
        );
      await client.query(
        'UPDATE contact_reports SET resolution=$2,resolved_at=clock_timestamp() WHERE id=$1',
        [id, action],
      );
    });
  }
}
