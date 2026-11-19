import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Sessions } from '../auth/session.service.js';
import type { StationInput } from './station-input.js';
import { requireAdmin, Stations } from './stations.service.js';

export interface Proposal {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  station: StationInput;
  stationId: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}
const proposalColumns = `id, status, station, station_id AS "stationId",
  created_at AS "createdAt", reviewed_at AS "reviewedAt"`;

@Injectable()
export class StationProposals {
  constructor(
    @Inject(Stations) private readonly stations: Stations,
    @Inject(Sessions) private readonly sessions: Sessions,
  ) {}

  create(header: string | undefined, station: StationInput) {
    return this.sessions.authenticated(header, async (client, user) => {
      await this.stations.validateConnectors(client, station);
      const quota = await client.query<{ hits: number }>(
        `SELECT count(*)::int AS hits FROM station_proposals
         WHERE author_id=$1 AND created_at>statement_timestamp()-interval '24 hours'`,
        [user.id],
      );
      if (quota.rows[0].hits >= 3)
        throw new HttpException(
          'Proposal limit reached. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      const { rows } = await client.query<Proposal>(
        `INSERT INTO station_proposals (id, author_id, station) VALUES ($1,$2,$3::jsonb)
         RETURNING ${proposalColumns}`,
        [randomUUID(), user.id, JSON.stringify(station)],
      );
      return rows[0];
    });
  }

  mine(header?: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      const { rows } = await client.query<Proposal>(
        `SELECT ${proposalColumns} FROM station_proposals WHERE author_id=$1
         ORDER BY created_at DESC, id DESC LIMIT 100`,
        [user.id],
      );
      return rows;
    });
  }

  ownProposal(header: string | undefined, id: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      const { rows } = await client.query<Proposal>(
        `SELECT ${proposalColumns} FROM station_proposals WHERE author_id=$1 AND id=$2`,
        [user.id, id],
      );
      if (!rows[0]) throw new NotFoundException('Proposal unavailable.');
      return rows[0];
    });
  }

  pending(header?: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      requireAdmin(user);
      const { rows } = await client.query<Proposal>(
        `SELECT ${proposalColumns} FROM station_proposals WHERE status='pending'
         ORDER BY created_at, id LIMIT 100`,
      );
      return rows;
    });
  }

  review(
    header: string | undefined,
    id: string,
    decision: 'approve' | 'reject',
  ) {
    return this.sessions.authenticated(header, async (client, user) => {
      requireAdmin(user);
      const { rows } = await client.query<Proposal>(
        `SELECT ${proposalColumns} FROM station_proposals WHERE id=$1 FOR UPDATE`,
        [id],
      );
      const proposal = rows[0];
      if (!proposal) throw new NotFoundException('Proposal unavailable.');
      if (proposal.status !== 'pending')
        throw new ConflictException('Proposal already reviewed.');
      const stationId =
        decision === 'approve'
          ? await this.stations.publish(client, proposal.station)
          : null;
      const result = await client.query<Proposal>(
        `UPDATE station_proposals SET status=$2, station_id=$3, reviewed_by=$4, reviewed_at=clock_timestamp()
         WHERE id=$1 RETURNING ${proposalColumns}`,
        [
          id,
          decision === 'approve' ? 'approved' : 'rejected',
          stationId,
          user.id,
        ],
      );
      return result.rows[0];
    });
  }
}
