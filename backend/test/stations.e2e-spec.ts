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
        latestReportAt: null,
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
            latitude: null,
            longitude: null,
          },
        ],
      });
      await get('stations/' + local.id).expect(200, local);
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
      await get('stations?south=25&north=30&west=-101&east=-95').expect(
        200,
        [],
      );
      expect((await get('stations?limit=1').expect(200)).body).toHaveLength(1);
      await get('stations?south=10').expect(400);
      await get('stations?limit=201').expect(400);
      await get('stations/' + randomUUID()).expect(404);
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
        counts: { available: 0, occupied: 1, out_of_service: 1, unreported: 0 },
        chargers: [
          { status: 'occupied', latestReportAt: occupied.body.reportedAt },
          { status: 'out_of_service', latestReportAt: broken.body.reportedAt },
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
