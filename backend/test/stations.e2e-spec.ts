import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuthMail } from '../src/auth/auth-mail.service.js';
import { Sessions } from '../src/auth/session.service.js';
import { DatabaseService } from '../src/database/database.service.js';
import { readPostgresConfig } from '../src/database/database.config.js';
import { loadBackendEnv } from '../src/environment.js';
import { StationsModule } from '../src/stations/stations.module.js';

const schema = 'stations_test_' + randomUUID().replaceAll('-', '');
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function sameStation(expected: object) {
  return ({ body }: { body: unknown }) => {
    expect(body).toEqual({
      ...expected,
      statusAsOf: expect.stringMatching(isoTimestamp),
    });
  };
}
const draft = {
  name: 'Community parking',
  address: '10 Example Street',
  latitude: 19.4,
  longitude: -99.1,
  chargers: [
    {
      label: 'Bay 1',
      connectorTypes: ['nacs', 'ccs1'],
      latitude: 19.401,
      longitude: -99.101,
    },
    { label: 'Bay 2', connectorTypes: ['j1772'] },
  ],
};

describe.runIf(process.env.AUTH_TEST_POSTGRES === '1')(
  'stations over HTTP and PostgreSQL',
  () => {
    let adminPool: Pool;
    let pool: Pool;
    let app: INestApplication<App>;
    let server: App;
    let moderator: string;
    let otherModerator: string;
    let member: string;
    let neighbor: string;
    const get = (path: string) => request(server).get('/api/v1/' + path);
    const post = (path: string) => request(server).post('/api/v1/' + path);

    async function account(isAdmin: boolean) {
      const id = randomUUID();
      return app.get(DatabaseService).transaction(async (client) => {
        await client.query(
          'INSERT INTO auth_users (id,email,name,password_hash,is_admin) VALUES ($1,$2,$3,$4,$5)',
          [id, id + '@example.test', 'Fixture', 'unused', isAdmin],
        );
        return (await app.get(Sessions).issue(client, id)).accessToken;
      });
    }

    beforeAll(async () => {
      loadBackendEnv();
      const config = readPostgresConfig(process.env);
      adminPool = new Pool(config);
      await adminPool.query('CREATE SCHEMA ' + schema);
      pool = new Pool({ ...config, options: '-c search_path=' + schema });
      for (const name of [
        '001_first_party_auth.sql',
        '002_charging_stations.sql',
        '004_administrator_role.sql',
        '005_station_sources.sql',
        '006_household_connector_types.sql',
        '007_occupied_report_timers.sql',
        '008_station_classification.sql',
      ]) {
        await pool.query(
          await readFile(
            new URL('../migrations/' + name, import.meta.url),
            'utf8',
          ),
        );
      }
      vi.stubEnv('AUTH_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
      const fixture = await Test.createTestingModule({
        imports: [StationsModule],
      })
        .overrideProvider(DatabaseService)
        .useValue(new DatabaseService(pool))
        .overrideProvider(AuthMail)
        .useValue({ send: vi.fn() })
        .compile();
      app = fixture.createNestApplication();
      await app.listen(0, '127.0.0.1');
      server = app.getHttpServer();
      [moderator, otherModerator, member, neighbor] = await Promise.all([
        account(true),
        account(true),
        account(false),
        account(false),
      ]);
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      if (app) await app.close();
      else if (pool) await pool.end();
      if (adminPool) {
        try {
          await adminPool.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
        } finally {
          await adminPool.end();
        }
      }
    });

    beforeEach(async () => {
      await pool.query('TRUNCATE station_proposals, charging_stations CASCADE');
    });

    it('validates stations against the catalog and returns capped public viewport results, including across the dateline', async () => {
      const types = await get('connector-types').expect(200);
      expect(types.body).toContainEqual({ id: 'ccs1', label: 'CCS Combo 1' });
      await post('stations').send(draft).expect(401);
      await post('stations')
        .auth(member, { type: 'bearer' })
        .send(draft)
        .expect(403);
      const create = (fields: Record<string, unknown>) =>
        post('stations')
          .auth(moderator, { type: 'bearer' })
          .send({ ...draft, ...fields });
      await create({ latitude: 100 }).expect(400);
      await create({ chargers: [] }).expect(400);
      await create({
        chargers: [{ label: 'Unknown', connectorTypes: ['unknown'] }],
      }).expect(400);
      await create({
        chargers: [
          { label: 'Partial', connectorTypes: ['ccs1'], latitude: 20 },
        ],
      }).expect(400);
      await get('stations').expect(200, []);
      const local = (await create({}).expect(201)).body;
      expect(local).toMatchObject({
        name: draft.name,
        access_type: 'unknown',
        pricing_type: 'unknown',
        statusAsOf: expect.stringMatching(isoTimestamp),
        latestReportAt: null,
        nextStatusChangeAt: null,
        counts: { available: 0, occupied: 0, out_of_service: 0, unreported: 2 },
        chargers: [
          {
            label: 'Bay 1',
            connectorTypes: ['ccs1', 'nacs'],
            latitude: 19.401,
            longitude: -99.101,
          },
          {
            label: 'Bay 2',
            status: 'unreported',
            latestReportAt: null,
            occupiedUntil: null,
            availableByTimer: false,
            latitude: null,
            longitude: null,
          },
        ],
      });
      await get('stations/' + local.id)
        .expect(200)
        .expect(sameStation(local));
      const east = (await create({ longitude: 179.5 }).expect(201)).body
        .id as string;
      const west = (await create({ longitude: -179.5 }).expect(201)).body
        .id as string;
      const mapped = await get(
        'stations?south=10&north=20&west=179&east=-179',
      ).expect(200);
      expect(mapped.body.map((row: { id: string }) => row.id)).toEqual(
        [east, west].sort(),
      );
      expect(mapped.body[0]).not.toHaveProperty('chargers');
      expect(mapped.body[0]).toMatchObject({
        access_type: 'unknown',
        pricing_type: 'unknown',
      });
      expect(mapped.body[0].statusAsOf).toMatch(isoTimestamp);
      expect(mapped.body[1].statusAsOf).toBe(mapped.body[0].statusAsOf);
      const expanded = await get(
        'stations?south=10&north=20&west=179&east=-179&limit=1&includeChargers=true',
      ).expect(200);
      expect(expanded.body).toHaveLength(1);
      expect(expanded.body[0].id).toBe(mapped.body[0].id);
      const detail = (await get('stations/' + expanded.body[0].id).expect(200))
        .body;
      sameStation(detail)({ body: expanded.body[0] });
      expect(expanded.body[0].chargers).toMatchObject([
        {
          latitude: 19.401,
          longitude: -99.101,
          connectorTypes: ['ccs1', 'nacs'],
        },
        { latitude: null, longitude: null, connectorTypes: ['j1772'] },
      ]);
      const summary = await get(
        'stations?limit=1&includeChargers=false',
      ).expect(200);
      expect(summary.body[0]).not.toHaveProperty('chargers');
      for (const query of [
        'includeChargers=1',
        'includeChargers=',
        'includeChargers=true&includeChargers=false',
      ])
        await get('stations?' + query).expect(400);
      await get('stations?south=25&north=30&west=-101&east=-95').expect(
        200,
        [],
      );
      expect((await get('stations?limit=1').expect(200)).body).toHaveLength(1);
      await get('stations?south=10').expect(400);
      await get('stations?limit=201').expect(400);
      await get('stations/' + randomUUID()).expect(404);
    });

    it('includes a station outside the viewport when a charger lies inside on either side of the dateline', async () => {
      const create = (chargerLongitude: number) =>
        post('stations')
          .auth(moderator, { type: 'bearer' })
          .send({
            ...draft,
            longitude: 178.9,
            chargers: [
              { ...draft.chargers[0], longitude: chargerLongitude },
              draft.chargers[1],
            ],
          })
          .expect(201);
      const west = (await create(-179.9)).body;
      const east = (await create(179.9)).body;
      await create(178.95);
      const wrapped = 'stations?south=19&north=20&west=179&east=-179';
      await get(wrapped).expect(200, []);
      const { body } = await get(wrapped + '&includeChargers=true').expect(200);
      const expectedIds = [east.id as string, west.id as string].sort();
      expect(body.map((station: { id: string }) => station.id)).toEqual(
        expectedIds,
      );
      expect(body[0].chargers).toHaveLength(2);
      const limited = await get(
        wrapped + '&includeChargers=true&limit=1',
      ).expect(200);
      expect(limited.body.map((station: { id: string }) => station.id)).toEqual(
        expectedIds.slice(0, 1),
      );
      const ordinary = await get(
        'stations?south=19&north=20&west=-180&east=-179&includeChargers=true',
      ).expect(200);
      expect(
        ordinary.body.map((station: { id: string }) => station.id),
      ).toEqual([west.id]);
    });

    it('resolves simultaneous catalog imports to one station and preserves reports on replay', async () => {
      const source = {
        provider: 'fixture',
        externalId: 'A-1',
        sourceUrl: 'https://example.test/listings/A-1',
      };
      const importListing = (token: string) =>
        post('stations')
          .auth(token, { type: 'bearer' })
          .send({ ...draft, source });
      const [first, second] = await Promise.all([
        importListing(moderator).expect(201),
        importListing(otherModerator).expect(201),
      ]);
      sameStation(first.body)(second);
      expect((await get('stations').expect(200)).body).toHaveLength(1);
      const path = 'stations/' + first.body.id;
      await post(path + '/chargers/' + first.body.chargers[0].id + '/reports')
        .auth(member, { type: 'bearer' })
        .send({ status: 'occupied' })
        .expect(201);
      const reported = (await get(path).expect(200)).body;
      await post('stations')
        .auth(moderator, { type: 'bearer' })
        .send({
          ...draft,
          name: 'Updated source name',
          chargers: [draft.chargers[1]],
          source: { ...source, sourceUrl: 'https://example.test/revised' },
        })
        .expect(201)
        .expect(sameStation(reported));
      expect(
        (
          await pool.query(
            'SELECT station_id, provider, external_id, source_url FROM station_sources',
          )
        ).rows,
      ).toEqual([
        {
          station_id: first.body.id,
          provider: source.provider,
          external_id: source.externalId,
          source_url: source.sourceUrl,
        },
      ]);
    });

    it('attaches distinct confirmed listings to a community station and rejects conflicts atomically', async () => {
      const create = (fields: Record<string, unknown>) =>
        post('stations')
          .auth(moderator, { type: 'bearer' })
          .send({ ...draft, ...fields });
      const station = (await create({}).expect(201)).body;
      const other = (await create({}).expect(201)).body;
      const path = 'stations/' + station.id;
      await post(path + '/chargers/' + station.chargers[0].id + '/reports')
        .auth(member, { type: 'bearer' })
        .send({ status: 'available' })
        .expect(201);
      const reported = (await get(path).expect(200)).body;
      const source = {
        provider: 'fixture',
        externalId: '1',
        sourceUrl: 'https://example.test/1',
      };
      await create({ source, existingStationId: randomUUID() }).expect(404);
      await create({
        source,
        existingStationId: station.id,
        name: 'Different label',
      })
        .expect(201)
        .expect(sameStation(reported));
      await create({
        source,
        existingStationId: station.id.toUpperCase(),
      })
        .expect(201)
        .expect(sameStation(reported));
      await create({
        source: { ...source, provider: 'second_catalog' },
        existingStationId: station.id,
      })
        .expect(201)
        .expect(sameStation(reported));
      await create({ source, existingStationId: other.id }).expect(409);
      await create({
        source,
        chargers: [{ label: 'Unknown', connectorTypes: ['unknown'] }],
      }).expect(400);
      expect(
        (await pool.query('SELECT station_id FROM station_sources')).rows,
      ).toEqual([{ station_id: station.id }, { station_id: station.id }]);
      await get('stations/' + other.id)
        .expect(200)
        .expect(sameStation(other));
    });

    it('validates source identities and restricts imports to administrators', async () => {
      const source = {
        provider: 'catalog',
        externalId: '1',
        sourceUrl: 'https://example.test/1',
      };
      await post('stations')
        .send({ ...draft, source })
        .expect(401);
      await post('stations')
        .auth(member, { type: 'bearer' })
        .send({ ...draft, source })
        .expect(403);
      await post('station-proposals')
        .auth(member, { type: 'bearer' })
        .send({ ...draft, source })
        .expect(400);
      const invalid = [
        { source: null },
        { source: { ...source, provider: 'Bad Provider' } },
        { source: { ...source, externalId: ' ' } },
        { source: { ...source, sourceUrl: '/relative' } },
        { source: { ...source, sourceUrl: 'file:///private' } },
        { source: { ...source, sourceUrl: 'https://user:pass@example.test/' } },
        { source: { ...source, extra: 'unexpected' } },
        { existingStationId: randomUUID() },
        { source, existingStationId: 'invalid' },
        { source, chargers: [] },
      ];
      for (const fields of invalid)
        await post('stations')
          .auth(moderator, { type: 'bearer' })
          .send({ ...draft, ...fields })
          .expect(400);
      await get('stations').expect(200, []);
      expect((await pool.query('SELECT * FROM station_sources')).rows).toEqual(
        [],
      );
    });

    it('enforces reporting permissions and concurrent limits and counts the last status per physical charger', async () => {
      const station = (
        await post('stations')
          .auth(moderator, { type: 'bearer' })
          .send(draft)
          .expect(201)
      ).body;
      const other = (
        await post('stations')
          .auth(moderator, { type: 'bearer' })
          .send(draft)
          .expect(201)
      ).body;
      const [first, second] = station.chargers as { id: string }[];
      const path =
        'stations/' + station.id + '/chargers/' + first.id + '/reports';
      await post(path).send({ status: 'available' }).expect(401);
      await post(path)
        .auth(member, { type: 'bearer' })
        .send({ status: 'unreported' })
        .expect(400);
      await post(path)
        .auth(member, { type: 'bearer' })
        .send({ status: 'occupied', comment: 'extra' })
        .expect(400);
      await post('stations/' + other.id + '/chargers/' + first.id + '/reports')
        .auth(member, { type: 'bearer' })
        .send({ status: 'occupied' })
        .expect(404);
      const report = () =>
        post(path)
          .auth(member, { type: 'bearer' })
          .send({ status: 'available' });
      const pair = await Promise.all([report(), report()]);
      expect(
        pair.map((response) => response.status).sort((a, b) => a - b),
      ).toEqual([201, 429]);
      const occupied = await post(path)
        .auth(neighbor, { type: 'bearer' })
        .send({ status: 'occupied' })
        .expect(201);
      expect(Object.keys(occupied.body).sort()).toEqual([
        'chargerId',
        'id',
        'occupiedUntil',
        'reportedAt',
        'status',
      ]);
      const broken = await post(
        'stations/' + station.id + '/chargers/' + second.id + '/reports',
      )
        .auth(member, { type: 'bearer' })
        .send({ status: 'out_of_service' })
        .expect(201);
      const details = await get('stations/' + station.id).expect(200);
      expect(details.body).toMatchObject({
        latestReportAt: broken.body.reportedAt,
        nextStatusChangeAt: null,
        counts: { available: 0, occupied: 1, out_of_service: 1, unreported: 0 },
        chargers: [
          {
            status: 'occupied',
            latestReportAt: occupied.body.reportedAt,
            occupiedUntil: null,
            availableByTimer: false,
          },
          {
            status: 'out_of_service',
            latestReportAt: broken.body.reportedAt,
            occupiedUntil: null,
            availableByTimer: false,
          },
        ],
      });
      const markers = (await get('stations').expect(200)).body as {
        id: string;
        counts: unknown;
        latestReportAt: string;
      }[];
      expect(markers.find((row) => row.id === station.id)).toMatchObject({
        counts: details.body.counts,
        latestReportAt: broken.body.reportedAt,
      });
      await pool.query(
        "UPDATE charger_reports SET reported_at=reported_at-interval '2 days' WHERE charger_id=$1",
        [first.id],
      );
      expect(
        (await get('stations/' + station.id).expect(200)).body.chargers[0],
      ).toMatchObject({
        status: 'occupied',
        occupiedUntil: null,
        availableByTimer: false,
      });
    });

    it('validates occupied duration and derives expiry from the latest report using database time', async () => {
      const station = (
        await post('stations')
          .auth(moderator, { type: 'bearer' })
          .send(draft)
          .expect(201)
      ).body;
      const path = 'stations/' + station.id;
      const report = (bay: number, body: object, token = member) =>
        post(path + '/chargers/' + station.chargers[bay].id + '/reports')
          .auth(token, { type: 'bearer' })
          .send(body);
      const invalid = [
        ...[0, 721, 1.5, '10', null].map((durationMinutes) => ({
          status: 'occupied',
          durationMinutes,
        })),
        { status: 'available', durationMinutes: 10 },
        { status: 'out_of_service', durationMinutes: 10 },
        { status: 'occupied', occupiedUntil: '2099-01-01T00:00:00Z' },
      ];
      for (const body of invalid) await report(0, body).expect(400);

      const first = (
        await report(0, { status: 'occupied', durationMinutes: 1 }).expect(201)
      ).body;
      const second = (
        await report(1, { status: 'occupied', durationMinutes: 720 }).expect(
          201,
        )
      ).body;
      for (const [row, minutes] of [
        [first, 1],
        [second, 720],
      ] as const) {
        expect(Date.parse(row.occupiedUntil) - Date.parse(row.reportedAt)).toBe(
          minutes * 60_000,
        );
      }
      const active = (await get(path).expect(200)).body;
      expect(Date.parse(active.statusAsOf)).toBeGreaterThanOrEqual(
        Date.parse(first.reportedAt),
      );
      expect(Date.parse(active.statusAsOf)).toBeLessThan(
        Date.parse(first.occupiedUntil),
      );
      expect(active).toMatchObject({
        nextStatusChangeAt: first.occupiedUntil,
        counts: { occupied: 2, available: 0 },
        chargers: [first, second].map((row) => ({
          status: 'occupied',
          occupiedUntil: row.occupiedUntil,
          availableByTimer: false,
        })),
      });
      const expanded = await get('stations?includeChargers=true').expect(200);
      sameStation(active)({ body: expanded.body[0] });
      expect((await get('stations').expect(200)).body[0]).toMatchObject({
        nextStatusChangeAt: first.occupiedUntil,
        counts: active.counts,
      });

      const history = await pool.query<{ reported_at: Date }>(
        "UPDATE charger_reports SET reported_at=statement_timestamp()-interval '2 minutes' WHERE id=$1 RETURNING reported_at",
        [first.id],
      );
      const expired = (await get(path).expect(200)).body;
      expect(Date.parse(expired.statusAsOf)).toBeGreaterThanOrEqual(
        history.rows[0].reported_at.getTime() + 60_000,
      );
      expect(expired).toMatchObject({
        latestReportAt: second.reportedAt,
        nextStatusChangeAt: second.occupiedUntil,
        counts: { available: 1, occupied: 1 },
        chargers: [
          {
            status: 'available',
            latestReportAt: history.rows[0].reported_at.toISOString(),
            occupiedUntil: null,
            availableByTimer: true,
          },
          {
            status: 'occupied',
            latestReportAt: second.reportedAt,
            occupiedUntil: second.occupiedUntil,
            availableByTimer: false,
          },
        ],
      });
      expect((await get('stations').expect(200)).body[0]).toMatchObject({
        nextStatusChangeAt: second.occupiedUntil,
        counts: expired.counts,
      });
      expect(
        (await pool.query('SELECT id,status FROM charger_reports ORDER BY id'))
          .rows,
      ).toEqual([
        { id: first.id, status: 'occupied' },
        { id: second.id, status: 'occupied' },
      ]);

      const newer = (
        await report(1, { status: 'out_of_service' }, neighbor).expect(201)
      ).body;
      expect(newer.occupiedUntil).toBeNull();
      expect((await get(path).expect(200)).body).toMatchObject({
        nextStatusChangeAt: null,
        chargers: [
          { status: 'available' },
          {
            status: 'out_of_service',
            occupiedUntil: null,
            availableByTimer: false,
          },
        ],
      });
      // Age both reports so the superseded timer has also elapsed, preserving their order.
      await pool.query(
        "UPDATE charger_reports SET reported_at=reported_at-interval '13 hours' WHERE charger_id=$1",
        [station.chargers[1].id],
      );
      const superseded = (await get(path).expect(200)).body;
      expect(superseded).toMatchObject({
        nextStatusChangeAt: null,
        counts: { available: 1, occupied: 0, out_of_service: 1, unreported: 0 },
        chargers: [
          { availableByTimer: true },
          {
            status: 'out_of_service',
            occupiedUntil: null,
            availableByTimer: false,
          },
        ],
      });
      expect((await get('stations').expect(200)).body[0]).toMatchObject({
        nextStatusChangeAt: null,
        counts: superseded.counts,
      });
    });

    it('keeps proposals private and publishes once when distinct moderators race to approve', async () => {
      const proposal = (
        await post('station-proposals')
          .auth(member, { type: 'bearer' })
          .send(draft)
          .expect(201)
      ).body;
      const own = 'station-proposals/' + proposal.id;
      const queue = 'admin/station-proposals';
      const review = (token: string, decision: string) =>
        post(queue + '/' + proposal.id + '/review')
          .auth(token, { type: 'bearer' })
          .send({ decision });
      await get('station-proposals').expect(401);
      await get('stations').expect(200, []);
      await get(own).auth(neighbor, { type: 'bearer' }).expect(404);
      await get('station-proposals')
        .auth(neighbor, { type: 'bearer' })
        .expect(200, []);
      await get(queue).auth(member, { type: 'bearer' }).expect(403);
      await review(member, 'approve').expect(403);
      await get(queue)
        .auth(moderator, { type: 'bearer' })
        .expect(200, [proposal]);
      const pair = await Promise.all([
        review(moderator, 'approve'),
        review(otherModerator, 'approve'),
      ]);
      expect(
        pair.map((response) => response.status).sort((a, b) => a - b),
      ).toEqual([200, 409]);
      const published = pair.find((response) => response.status === 200)!.body;
      expect(published).toMatchObject({
        id: proposal.id,
        status: 'approved',
        reviewedAt: expect.any(String),
      });
      await get(own).auth(member, { type: 'bearer' }).expect(200, published);
      await get(queue).auth(moderator, { type: 'bearer' }).expect(200, []);
      await get('stations/' + published.stationId).expect(200);
      expect((await get('stations').expect(200)).body).toHaveLength(1);
      await review(otherModerator, 'reject').expect(409);
    });

    it('rejects invalid proposals, bounds submissions and keeps rejected stations off the map', async () => {
      const propose = () =>
        post('station-proposals').auth(member, { type: 'bearer' });
      await propose()
        .send({
          ...draft,
          chargers: [{ label: 'New', connectorTypes: ['invalid'] }],
        })
        .expect(400);
      for (let i = 0; i < 3; i++) await propose().send(draft).expect(201);
      await propose().send(draft).expect(429);
      const mine = await get('station-proposals')
        .auth(member, { type: 'bearer' })
        .expect(200);
      const id = mine.body[0].id as string;
      const path = 'admin/station-proposals/' + id + '/review';
      await post(path)
        .auth(moderator, { type: 'bearer' })
        .send({ decision: 'skip' })
        .expect(400);
      const rejected = await post(path)
        .auth(moderator, { type: 'bearer' })
        .send({ decision: 'reject' })
        .expect(200);
      expect(rejected.body).toMatchObject({
        status: 'rejected',
        stationId: null,
      });
      await get('station-proposals/' + id)
        .auth(member, { type: 'bearer' })
        .expect(200, rejected.body);
      await get('stations').expect(200, []);
    });
  },
);
