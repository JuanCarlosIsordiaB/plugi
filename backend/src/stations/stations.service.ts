import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Sessions, type UserRow } from '../auth/session.service.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  ReportStatus,
  StationFilter,
  StationInput,
} from './station-input.js';

export function requireAdmin(user: UserRow) {
  if (!user.is_admin)
    throw new ForbiddenException('Administrator access required.');
}

export interface StationSummary extends Omit<StationInput, 'chargers'> {
  id: string;
  latestReportAt: Date | null;
  counts: Record<ReportStatus | 'unreported', number>;
}
export interface StationDetail extends StationSummary {
  chargers: (StationInput['chargers'][number] & {
    id: string;
    status: ReportStatus | 'unreported';
    latestReportAt: string | null;
  })[];
}

const availabilityColumns = `
  max(c.reported_at) AS "latestReportAt",
  jsonb_build_object(
    'available', count(*) FILTER (WHERE c.status='available'),
    'occupied', count(*) FILTER (WHERE c.status='occupied'),
    'out_of_service', count(*) FILTER (WHERE c.status='out_of_service'),
    'unreported', count(*) FILTER (WHERE c.status='unreported')
  ) AS counts`;

@Injectable()
export class Stations {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(Sessions) private readonly sessions: Sessions,
  ) {}

  async connectorTypes() {
    const { rows } = await this.db.query<{ id: string; label: string }>(
      'SELECT id, label FROM connector_types ORDER BY id',
    );
    return rows;
  }

  async list({ south, west, north, east, limit }: StationFilter) {
    const { rows } = await this.db.query<StationSummary>(
      `SELECT s.*, a.* FROM (
        SELECT * FROM charging_stations
        WHERE ($1::float8 IS NULL OR latitude BETWEEN $1 AND $3)
          AND ($2::float8 IS NULL OR
            CASE WHEN $2 <= $4::float8 THEN longitude BETWEEN $2 AND $4
                 ELSE longitude >= $2 OR longitude <= $4 END)
        ORDER BY id LIMIT $5
      ) s CROSS JOIN LATERAL (
        SELECT ${availabilityColumns}
        FROM charger_availability c WHERE c.station_id=s.id
      ) a ORDER BY s.id`,
      [south, west, north, east, limit],
    );
    return rows;
  }

  async detail(id: string, client?: PoolClient) {
    const sql = `SELECT s.*, a.* FROM charging_stations s CROSS JOIN LATERAL (
        SELECT ${availabilityColumns},
          jsonb_agg(jsonb_build_object(
            'id', c.id, 'label', c.label, 'latitude', c.latitude, 'longitude', c.longitude,
            'connectorTypes', ARRAY(SELECT connector_type FROM charger_connectors
              WHERE charger_id=c.id ORDER BY connector_type),
            'status', c.status,
            'latestReportAt', to_char(c.reported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ) ORDER BY c.position) AS chargers
        FROM charger_availability c WHERE c.station_id=s.id
      ) a WHERE s.id=$1`;
    const { rows } = client
      ? await client.query<StationDetail>(sql, [id])
      : await this.db.query<StationDetail>(sql, [id]);
    if (!rows[0]) throw new NotFoundException('Station unavailable.');
    return rows[0];
  }

  async validateConnectors(client: PoolClient, station: StationInput) {
    const types = new Set(
      station.chargers.flatMap((charger) => charger.connectorTypes),
    );
    const { rowCount } = await client.query(
      'SELECT id FROM connector_types WHERE id = ANY($1::text[]) FOR KEY SHARE',
      [[...types]],
    );
    if (rowCount !== types.size)
      throw new BadRequestException('Unknown connector type.');
  }

  async publish(client: PoolClient, station: StationInput) {
    await this.validateConnectors(client, station);
    const id = randomUUID();
    await client.query(
      'INSERT INTO charging_stations (id, name, address, latitude, longitude) VALUES ($1,$2,$3,$4,$5)',
      [id, station.name, station.address, station.latitude, station.longitude],
    );
    const chargers = station.chargers.map((c, position) => ({
      ...c,
      id: randomUUID(),
      position,
    }));
    await client.query(
      `WITH input AS (
        SELECT * FROM jsonb_to_recordset($2::jsonb)
        AS c(id uuid, position int, label text, latitude float8, longitude float8, "connectorTypes" text[])
      ), inserted AS (
        INSERT INTO station_chargers (id, station_id, position, label, latitude, longitude)
        SELECT id, $1, position, label, latitude, longitude FROM input RETURNING id
      )
      INSERT INTO charger_connectors (charger_id, connector_type)
      SELECT i.id, unnest(i."connectorTypes") FROM input i JOIN inserted USING (id)`,
      [id, JSON.stringify(chargers)],
    );
    return id;
  }

  create(header: string | undefined, station: StationInput) {
    return this.sessions.authenticated(header, async (client, user) => {
      requireAdmin(user);
      return this.detail(await this.publish(client, station), client);
    });
  }

  report(
    header: string | undefined,
    stationId: string,
    chargerId: string,
    status: ReportStatus,
  ) {
    return this.sessions.authenticated(header, async (client, user) => {
      const charger = await client.query(
        'SELECT id FROM station_chargers WHERE id=$1 AND station_id=$2 FOR KEY SHARE',
        [chargerId, stationId],
      );
      if (!charger.rowCount)
        throw new NotFoundException('Charger unavailable at this station.');
      // Sessions.authenticated locks the user, serializing quota checks across all of their sessions.
      const { rows } = await client.query<{ hourly: number; recent: boolean }>(
        `SELECT count(*)::int AS hourly,
          coalesce(bool_or(charger_id=$2 AND reported_at>statement_timestamp()-interval '1 minute'), false) AS recent
         FROM charger_reports WHERE reporter_id=$1 AND reported_at>statement_timestamp()-interval '1 hour'`,
        [user.id, chargerId],
      );
      if (rows[0].recent || rows[0].hourly >= 30)
        throw new HttpException(
          'Report limit reached. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      const result = await client.query<{
        id: string;
        chargerId: string;
        status: ReportStatus;
        reportedAt: Date;
      }>(
        `INSERT INTO charger_reports (charger_id,reporter_id,status) VALUES ($1,$2,$3)
         RETURNING id, charger_id AS "chargerId", status, reported_at AS "reportedAt"`,
        [chargerId, user.id, status],
      );
      return result.rows[0];
    });
  }
}
