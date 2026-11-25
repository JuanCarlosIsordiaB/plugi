import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuthSecrets } from '../auth/credentials.js';
import { Sessions } from '../auth/session.service.js';
import { bodyFields } from '../auth/input.js';
import { consumeBudget, limited } from './contact-budget.js';
import { initiation, lookupIdentifier, messageBody } from './input.js';
import {
  issueContactToken,
  readContactToken,
  uniqueMexicanRegistration,
} from './plate-contact.js';

interface Conversation {
  initiator: string;
  recipient: string;
}
export interface Message {
  id: string;
  body: string;
  createdAt: Date;
  mine: boolean;
}
const visible = '(recipient=$1 OR (initiator=$1 AND answered))';
const messageCols = 'id,body,created_at AS "createdAt"';

async function registeredOwner(
  client: PoolClient,
  target: Exclude<
    ReturnType<typeof lookupIdentifier>,
    { mexicanPlate: string }
  >,
) {
  // Honor historical opt-outs until the owner removes and re-registers the vehicle.
  const select =
    'SELECT owner_id FROM contact_vehicles WHERE accepts_contact AND ';
  const result =
    'vin' in target
      ? await client.query<{ owner_id: string }>(select + 'vin=$1 FOR SHARE', [
          target.vin,
        ])
      : await client.query<{ owner_id: string }>(
          select +
            'plate=$1 AND plate_country=$2 AND plate_region=$3 FOR SHARE',
          [target.plate, target.plateCountry, target.plateRegion],
        );
  return result.rows[0]?.owner_id;
}

async function conversation(client: PoolClient, user: string, id: string) {
  const { rows } = await client.query<Conversation>(
    'SELECT initiator,recipient FROM contact_conversations WHERE ' +
      visible +
      ' AND id=$2',
    [user, id],
  );
  if (!rows[0]) throw new NotFoundException();
  return rows[0];
}

async function pairLock(client: PoolClient, first: string, second: string) {
  // Block and delivery share an unordered pair lock, also across different conversations.
  const key = [first, second].sort().join(':');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    key,
  ]);
}

async function canDeliver(
  client: PoolClient,
  sender: string,
  recipient: string,
) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM contact_blocks WHERE (blocker=$1 AND blocked=$2) OR (blocker=$2 AND blocked=$1)
     UNION ALL SELECT 1 FROM contact_suspensions WHERE user_id=$2`,
    [sender, recipient],
  );
  return !rowCount;
}

async function deliver(
  client: PoolClient,
  id: string,
  fromInitiator: boolean,
  body: string,
) {
  const result = await client.query<Message>(
    'INSERT INTO contact_messages(id,conversation_id,from_initiator,body) VALUES ($1,$2,$3,$4) RETURNING ' +
      messageCols +
      ',true AS mine',
    [randomUUID(), id, fromInitiator, body],
  );
  return result.rows[0];
}

@Injectable()
export class Conversations {
  constructor(
    @Inject(Sessions) private readonly sessions: Sessions,
    @Inject(AuthSecrets) private readonly secrets: AuthSecrets,
  ) {}

  private async chargeSender(
    header: string | undefined,
    scope: string,
    maximum: number,
  ) {
    // Commit the sender charge before parsing or delivering. Failed attempts still consume quota.
    const allowed = await this.sessions.authenticated(header, (client, user) =>
      consumeBudget(client, scope, user.id, maximum),
    );
    if (!allowed) limited();
  }
  private async requireSending(client: PoolClient, user: string) {
    const result = await client.query(
      'SELECT 1 FROM contact_suspensions WHERE user_id=$1',
      [user],
    );
    if (result.rowCount)
      throw new ForbiddenException('Messaging is suspended.');
  }

  async lookup(header: string | undefined, input: unknown, ip: string) {
    const allowed = await this.sessions.authenticated(
      header,
      async (client, user) => {
        if (!(await consumeBudget(client, 'lookup-account', user.id, 10)))
          return false;
        return consumeBudget(client, 'lookup-ip', ip, 40);
      },
    );
    if (!allowed) limited();
    const target = lookupIdentifier(input);
    return this.sessions.authenticated(header, async (client, user) => {
      if ('mexicanPlate' in target) {
        const registration = await uniqueMexicanRegistration(
          client,
          target.mexicanPlate,
        );
        if (!registration) return { registered: false };
        return {
          registered: true,
          contactToken: issueContactToken(
            this.secrets,
            user.id,
            registration.id,
            target.mexicanPlate,
          ),
        };
      }
      return { registered: Boolean(await registeredOwner(client, target)) };
    });
  }

  private async tokenRecipient(
    client: PoolClient,
    token: string,
    caller: string,
  ) {
    const claim = readContactToken(this.secrets, token, caller);
    if (!claim) return;
    const current = await uniqueMexicanRegistration(client, claim.plate);
    if (current?.id === claim.registration) return current.owner_id;
  }

  async start(header: string | undefined, input: unknown) {
    await this.chargeSender(header, 'requests', 10);
    const { target, message } = initiation(input);
    await this.sessions.authenticated(header, async (client, user) => {
      await this.requireSending(client, user.id);
      const recipient =
        'contactToken' in target
          ? await this.tokenRecipient(client, target.contactToken, user.id)
          : await registeredOwner(client, target);
      if (!recipient || recipient === user.id) return;
      await pairLock(client, user.id, recipient);
      if (!(await canDeliver(client, user.id, recipient))) return;
      const pending = await client.query(
        `SELECT 1 FROM contact_conversations WHERE initiator=$1 AND recipient=$2 AND NOT answered
         AND updated_at>clock_timestamp()-interval '24 hours'`,
        [user.id, recipient],
      );
      if (pending.rowCount) return;
      // Silently suppress excess inbound requests across all vehicles/identifiers of the same owner.
      if (!(await consumeBudget(client, 'incoming-requests', recipient, 10)))
        return;
      const id = randomUUID();
      await client.query(
        'INSERT INTO contact_conversations(id,initiator,recipient) VALUES ($1,$2,$3)',
        [id, user.id, recipient],
      );
      await deliver(client, id, true, message);
    });
    return { accepted: true };
  }

  list(header: string | undefined, before?: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      const result = await client.query<{ id: string; updatedAt: Date }>(
        `SELECT id,updated_at AS "updatedAt" FROM contact_conversations WHERE ` +
          visible +
          ` AND ($2::uuid IS NULL OR (updated_at,id)<(SELECT updated_at,id FROM contact_conversations WHERE id=$2 AND ` +
          visible +
          ')) ORDER BY updated_at DESC,id DESC LIMIT 50',
        [user.id, before],
      );
      return { conversations: result.rows };
    });
  }
  read(header: string | undefined, id: string, before?: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      const thread = await conversation(client, user.id, id);
      const result = await client.query<Message>(
        'SELECT ' +
          messageCols +
          `,(from_initiator=$2) AS mine FROM contact_messages
        WHERE conversation_id=$1 AND NOT hidden
        AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM contact_messages WHERE conversation_id=$1 AND id=$3))
        ORDER BY created_at DESC,id DESC LIMIT 100`,
        [id, thread.initiator === user.id, before],
      );
      return { id, messages: result.rows.reverse() };
    });
  }
  async reply(header: string | undefined, id: string, input: unknown) {
    await this.chargeSender(header, 'replies', 60);
    const body = messageBody(bodyFields(input, ['message']).message);
    return this.sessions.authenticated(header, async (client, user) => {
      await this.requireSending(client, user.id);
      const thread = await conversation(client, user.id, id);
      const fromInitiator = thread.initiator === user.id;
      const peer = fromInitiator ? thread.recipient : thread.initiator;
      await pairLock(client, user.id, peer);
      if (!(await canDeliver(client, user.id, peer)))
        throw new ForbiddenException('Conversation is unavailable.');
      const message = await deliver(client, id, fromInitiator, body);
      await client.query(
        'UPDATE contact_conversations SET answered=true,updated_at=clock_timestamp() WHERE id=$1',
        [id],
      );
      return message;
    });
  }
  block(header: string | undefined, id: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      const thread = await conversation(client, user.id, id);
      const peer =
        thread.initiator === user.id ? thread.recipient : thread.initiator;
      await pairLock(client, user.id, peer);
      await client.query(
        'INSERT INTO contact_blocks(blocker,blocked) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [user.id, peer],
      );
    });
  }
}
