import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
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
  ReportInput,
  ReportStatus,
  StationCreateInput,
  StationFilter,
  StationInput,
} from './station-input.js';

export function requireAdmin(user: UserRow) {
  if (!user.is_admin)
    throw new ForbiddenException('Administrator access required.');
}

export interface StationSummary extends Omit<StationInput, 'chargers'> {
  id: string;
  access_type: 'public' | 'private' | 'restricted' | 'unknown';
  pricing_type: 'free' | 'paid' | 'mixed' | 'unknown';
  statusAsOf: Date;
  latestReportAt: Date | null;
  nextStatusChangeAt: Date | null;
  counts: Record<ReportStatus | 'unreported', number>;
}
export interface StationDetail extends StationSummary {
  chargers: (StationInput['chargers'][number] & {
    id: string;
    status: ReportStatus | 'unreported';
    latestReportAt: string | null;
    occupiedUntil: string | null;
    availableByTimer: boolean;
  })[];
}

const stationColumns = `station.id, station.name, station.address, station.latitude,
  station.longitude, station.access_type, station.pricing_type`;

const availabilityColumns = `
  statement_timestamp() AS "statusAsOf",
  max(c.reported_at) AS "latestReportAt",
  min(c.occupied_until) AS "nextStatusChangeAt",
  jsonb_build_object(
    'available', count(*) FILTER (WHERE c.status='available'),
    'occupied', count(*) FILTER (WHERE c.status='occupied'),
    'out_of_service', count(*) FILTER (WHERE c.status='out_of_service'),
    'unreported', count(*) FILTER (WHERE c.status='unreported')
  ) AS counts`;

const detailedAvailabilityColumns = `${availabilityColumns},
  jsonb_agg(jsonb_build_object(
    'id', c.id, 'label', c.label, 'latitude', c.latitude, 'longitude', c.longitude,
    'connectorTypes', ARRAY(SELECT connector_type FROM charger_connectors
      WHERE charger_id=c.id ORDER BY connector_type),
    'status', c.status,
    'availableByTimer', c.available_by_timer,
    'occupiedUntil', to_char(c.occupied_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'latestReportAt', to_char(c.reported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) ORDER BY c.position) AS chargers`;

function pointInViewport(table: 'station' | 'charger') {
  return `(${table}.latitude BETWEEN $1 AND $3
    AND CASE WHEN $2::float8 <= $4::float8 THEN ${table}.longitude BETWEEN $2 AND $4
             ELSE ${table}.longitude >= $2 OR ${table}.longitude <= $4 END)`;
}

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

  async list({
    south,
    west,
    north,
    east,
    limit,
    includeChargers,
  }: StationFilter) {
    const columns = includeChargers
      ? detailedAvailabilityColumns
      : availabilityColumns;
    const visibleCharger =
      includeChargers && south !== null
        ? `OR EXISTS (
          SELECT 1 FROM station_chargers charger
          WHERE charger.station_id=station.id AND ${pointInViewport('charger')}
        )`
        : '';
    const { rows } = await this.db.query<StationSummary | StationDetail>(
      `SELECT s.*, a.* FROM (
        SELECT ${stationColumns} FROM charging_stations station
        WHERE $1::float8 IS NULL OR ${pointInViewport('station')} ${visibleCharger}
        ORDER BY station.id LIMIT $5
      ) s CROSS JOIN LATERAL (
        SELECT ${columns}
        FROM charger_availability c WHERE c.station_id=s.id
      ) a ORDER BY s.id`,
      [south, west, north, east, limit],
    );
    return rows;
  }

  async detail(id: string, client?: PoolClient) {
    const sql = `SELECT ${stationColumns}, a.* FROM charging_stations station CROSS JOIN LATERAL (
        SELECT ${detailedAvailabilityColumns}
        FROM charger_availability c WHERE c.station_id=station.id
      ) a WHERE station.id=$1`;
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

  create(
    header: string | undefined,
    { station, source, existingStationId }: StationCreateInput,
  ) {
    return this.sessions.authenticated(header, async (client, user) => {
      requireAdmin(user);
      if (!source)
        return this.detail(await this.publish(client, station), client);

      const key = [source.provider, source.externalId];
      // The key can be absent. Serialize the lookup and creation across importers.
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        key,
      );
      const { rows } = await client.query<{ station_id: string }>(
        'SELECT station_id FROM station_sources WHERE provider=$1 AND external_id=$2',
        key,
      );
      const linkedId = rows[0]?.station_id;
      if (linkedId && existingStationId && linkedId !== existingStationId)
        throw new ConflictException(
          'Source listing is linked to a different station.',
        );

      const targetId = linkedId ?? existingStationId;
      if (targetId) await this.validateConnectors(client, station);
      if (linkedId) return this.detail(linkedId, client);

      const stationId = targetId ?? (await this.publish(client, station));
      const link = await client.query(
        `INSERT INTO station_sources (provider, external_id, source_url, station_id)
         SELECT $1, $2, $3, id FROM charging_stations WHERE id=$4 FOR KEY SHARE`,
        [...key, source.sourceUrl, stationId],
      );
      if (!link.rowCount) throw new NotFoundException('Station unavailable.');
      return this.detail(stationId, client);
    });
  }

  report(
    header: string | undefined,
    stationId: string,
    chargerId: string,
    { status, durationMinutes }: ReportInput,
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
        occupiedUntil: Date | null;
      }>(
        `INSERT INTO charger_reports (charger_id,reporter_id,status,duration_minutes) VALUES ($1,$2,$3,$4)
         RETURNING id, charger_id AS "chargerId", status, reported_at AS "reportedAt",
           reported_at + duration_minutes * interval '1 minute' AS "occupiedUntil"`,
        [chargerId, user.id, status, durationMinutes ?? null],
      );
      return result.rows[0];
    });
  }
}
