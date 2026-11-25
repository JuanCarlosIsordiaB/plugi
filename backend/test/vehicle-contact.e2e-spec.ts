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
import { VehicleContactModule } from '../src/vehicle-contact/vehicle-contact.module.js';

const schema = 'contact_test_' + randomUUID().replaceAll('-', '');
const vehicle = {
  vin: '1hgcm82633a004352',
  plate: 'aB-123',
  plateCountry: 'mx',
  plateRegion: 'cmx',
};
const another = {
  vin: '5YJ3E1EA7KF000001',
  plate: 'XY-456',
  plateCountry: 'MX',
  plateRegion: 'CMX',
};
const normalized = {
  vin: '1HGCM82633A004352',
  plate: 'AB123',
  plateCountry: 'MX',
  plateRegion: 'CMX',
};
const plate = {
  plate: vehicle.plate,
  plateCountry: vehicle.plateCountry,
  plateRegion: vehicle.plateRegion,
};
const start = '/vehicle-contact';
const inbox = start + '/conversations';
const reports = '/admin/vehicle-contact/reports';

describe.runIf(process.env.AUTH_TEST_POSTGRES === '1')(
  'vehicle registration and charging contact over HTTP and PostgreSQL',
  () => {
    let adminPool: Pool;
    let pool: Pool;
    let db: DatabaseService;
    let app: INestApplication<App>;
    let server: App;
    let sender: string;
    let owner: string;
    let outsider: string;

    async function account(admin = false) {
      return db.transaction(async (client) => {
        const id = randomUUID();
        await client.query(
          'INSERT INTO auth_users(id,email,name,password_hash,is_admin) VALUES ($1,$2,$3,$4,$5)',
          [id, id + '@example.test', 'Driver', 'unused', admin],
        );
        return (await app.get(Sessions).issue(client, id)).accessToken;
      });
    }
    beforeAll(async () => {
      loadBackendEnv();
      const pg = readPostgresConfig(process.env);
      adminPool = new Pool(pg);
      await adminPool.query('CREATE SCHEMA ' + schema);
      pool = new Pool({ ...pg, options: '-c search_path=' + schema });
      for (const migration of [
        '001_first_party_auth',
        '003_vehicle_contact',
        '004_administrator_role',
      ]) {
        await pool.query(
          await readFile(
            new URL('../migrations/' + migration + '.sql', import.meta.url),
            'utf8',
          ),
        );
      }
      vi.stubEnv('AUTH_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
      db = new DatabaseService(pool);
      const fixture = await Test.createTestingModule({
        imports: [VehicleContactModule],
      })
        .overrideProvider(DatabaseService)
        .useValue(db)
        .overrideProvider(AuthMail)
        .useValue({})
        .compile();
      app = fixture.createNestApplication();
      await app.listen(0, '127.0.0.1');
      server = app.getHttpServer();
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
      await pool.query('TRUNCATE auth_users,auth_rate_limits CASCADE');
      [sender, owner, outsider] = await Promise.all([
        account(),
        account(),
        account(),
      ]);
    });
    function api(
      method: 'post' | 'get' | 'delete' | 'patch',
      path: string,
      token?: string,
    ) {
      const call = request(server)[method]('/api/v1' + path);
      return token ? call.auth(token, { type: 'bearer' }) : call;
    }
    function send(token: string, input: object) {
      return api('post', start, token).send(input);
    }
    function lookup(token: string | undefined, input: object) {
      return api('post', start + '/lookup', token)
        .send(input)
        .expect('Cache-Control', 'no-store');
    }
    async function register() {
      const result = await api('post', '/vehicles', owner)
        .send(vehicle)
        .expect(201);
      expect(result.body).toEqual({ id: expect.any(String), ...normalized });
      return result.body.id as string;
    }
    async function plateToken() {
      const { body } = await lookup(sender, { plate: ' a B-123 ' }).expect(200);
      expect(body).toEqual({
        registered: true,
        contactToken: expect.any(String),
      });
      return body.contactToken as string;
    }
    async function threads(token: string) {
      return (await api('get', inbox, token).expect(200)).body
        .conversations as { id: string; updatedAt: string }[];
    }
    const receipt = { accepted: true };
    it('registers a Mexican vehicle with a VIN and plate and makes it reachable by both identifiers', async () => {
      const compact = { vin: vehicle.vin, plate: vehicle.plate };
      await api('post', '/vehicles').send(compact).expect(401);
      for (const invalid of [
        { ...compact, plateCountry: 'MX' },
        { ...compact, plateRegion: 'CMX' },
        { ...compact, plateCountry: 'MX', plateRegion: '' },
        { vin: vehicle.vin },
        { plate: vehicle.plate },
      ]) {
        await api('post', '/vehicles', owner).send(invalid).expect(400);
      }
      const foreign = {
        ...another,
        plate: vehicle.plate,
        plateCountry: 'US',
        plateRegion: 'CA',
      };
      await api('post', '/vehicles', outsider).send(foreign).expect(201);
      const { body } = await api('post', '/vehicles', owner)
        .send(compact)
        .expect(201);
      expect(body).toEqual({
        ...normalized,
        id: expect.any(String),
        plateRegion: '',
      });
      await api('get', '/vehicles', owner).expect(200, { vehicles: [body] });
      await send(sender, { contactToken: await plateToken() }).expect(
        202,
        receipt,
      );
      await lookup(outsider, { vin: vehicle.vin }).expect(200, {
        registered: true,
      });
      await send(outsider, { vin: vehicle.vin }).expect(202, receipt);
      expect(await threads(owner)).toHaveLength(2);
      expect(await threads(outsider)).toEqual([]);
    });

    it('rejects compact and region-qualified Mexican plate conflicts in either order', async () => {
      const compact = { vin: another.vin, plate: normalized.plate };
      const id = await register();
      const first = await api('post', '/vehicles', outsider)
        .send(compact)
        .expect(409);
      await api('delete', '/vehicles/' + id, owner).expect(204);
      await api('post', '/vehicles', outsider).send(compact).expect(201);
      await api('post', '/vehicles', owner)
        .send(vehicle)
        .expect(409, first.body);
      await api('post', '/vehicles', owner)
        .send({ ...vehicle, plateCountry: 'US', plateRegion: 'CA' })
        .expect(201);
    });

    it('serializes competing compact and qualified registrations of one Mexican plate', async () => {
      const results = await Promise.all([
        api('post', '/vehicles', owner).send(vehicle),
        api('post', '/vehicles', outsider).send({
          vin: another.vin,
          plate: normalized.plate,
        }),
      ]);
      expect(results.map((result) => result.status)).toEqual(
        expect.arrayContaining([201, 409]),
      );
      await plateToken();
    });

    it('normalizes and scopes multiple vehicles and both contact identifiers', async () => {
      await api('get', '/vehicles').expect(401);
      await api('post', start).send({ vin: vehicle.vin }).expect(401);
      const id = await register();
      await api('post', '/vehicles', owner)
        .send({ ...another, acceptsContact: false })
        .expect(400);
      await api('post', '/vehicles', owner).send(another).expect(201);
      const own = await api('get', '/vehicles', owner).expect(200);
      expect(own.body.vehicles).toHaveLength(2);
      expect(own.body.vehicles).toContainEqual({
        id,
        ...normalized,
      });
      await api('get', '/vehicles', sender).expect(200, { vehicles: [] });
      await api('delete', '/vehicles/' + id, sender).expect(404);
      await api('patch', '/vehicles/' + id, owner)
        .send({ acceptsContact: false })
        .expect(404);
      await api('post', '/vehicles', sender).send(vehicle).expect(409);
      await send(sender, { vin: 'BAD' }).expect(400);
      await send(sender, { ...plate, vin: vehicle.vin }).expect(400);
      await send(sender, { plate: plate.plate }).expect(400);
      await send(sender, { ...plate, plateRegion: 'JAL' }).expect(202, receipt);
      await send(sender, { vin: '5YJ3E1EA7KF000002' }).expect(202, receipt);
      expect(await threads(owner)).toEqual([]);
      await send(sender, plate).expect(202, receipt);
      expect(await threads(owner)).toHaveLength(1);
      await api('delete', '/vehicles/' + id, owner).expect(204);
      await send(outsider, plate).expect(202, receipt);
      expect(await threads(owner)).toHaveLength(1);
    });

    it('returns only registration status for an authenticated, exact identifier', async () => {
      const id = await register();
      await lookup(undefined, plate).expect(401);
      await lookup('invalid-token', plate).expect(401);
      await lookup(sender, { vin: vehicle.vin }).expect(200, {
        registered: true,
      });
      await lookup(sender, plate).expect(200, { registered: true });
      await lookup(sender, { vin: another.vin }).expect(200, {
        registered: false,
      });
      await lookup(sender, { ...plate, plateCountry: 'US' }).expect(200, {
        registered: false,
      });
      await lookup(sender, { ...plate, plateRegion: 'JAL' }).expect(200, {
        registered: false,
      });
      for (const invalid of [
        { vin: 'BAD' },
        { ...plate, vin: vehicle.vin },
        { plate: plate.plate, plateRegion: plate.plateRegion },
        { ...plate, message: 'Hello' },
      ]) {
        await lookup(sender, invalid).expect(400);
      }
      expect(await threads(owner)).toEqual([]);
      await api('delete', '/vehicles/' + id, owner).expect(204);
      await lookup(sender, plate).expect(200, { registered: false });
    });

    it('scopes compact lookup to Mexico and delivers only for the authenticated lookup caller', async () => {
      const compact = { plate: vehicle.plate };
      await lookup(undefined, compact).expect(401);
      await api('post', '/vehicles', outsider)
        .send({ ...another, ...compact, plateCountry: 'US', plateRegion: 'CA' })
        .expect(201);
      await lookup(sender, compact).expect(200, { registered: false });
      await register();
      await lookup(sender, { plate: 'AB12' }).expect(200, {
        registered: false,
      });
      const contactToken = await plateToken();
      await send(outsider, { contactToken }).expect(202, receipt);
      await send(sender, { contactToken, vin: vehicle.vin }).expect(400);
      await send(sender, { contactToken: 'invalid' }).expect(202, receipt);
      expect(await threads(owner)).toEqual([]);
      await send(sender, {
        contactToken,
        message: 'How long will you be charging?',
      }).expect(202, receipt);
      const owned = await threads(owner);
      expect(owned).toHaveLength(1);
      const read = await api('get', inbox + '/' + owned[0].id, owner).expect(
        200,
      );
      expect(read.body.messages[0].body).toBe('How long will you be charging?');
      expect(await threads(outsider)).toEqual([]);
      expect(await threads(sender)).toEqual([]);
    });

    it('suppresses ambiguous plates even when one registration is opted out', async () => {
      await register();
      const contactToken = await plateToken();
      const duplicate = await api('post', '/vehicles', outsider)
        .send({ ...another, plate: vehicle.plate, plateRegion: 'JAL' })
        .expect(201);
      const compact = { plate: vehicle.plate };
      await lookup(sender, compact).expect(200, { registered: false });
      await send(sender, { contactToken }).expect(202, receipt);
      await pool.query(
        'UPDATE contact_vehicles SET accepts_contact=false WHERE id=$1',
        [duplicate.body.id],
      );
      await lookup(sender, compact).expect(200, { registered: false });
      await send(sender, { contactToken }).expect(202, receipt);
      expect(await threads(owner)).toEqual([]);
      expect(await threads(outsider)).toEqual([]);
      await send(sender, plate).expect(202, receipt);
      expect(await threads(owner)).toHaveLength(1);
    });

    it('honors opt-outs and never retargets an old lookup after vehicle replacement', async () => {
      const id = await register();
      const contactToken = await plateToken();
      await pool.query(
        'UPDATE contact_vehicles SET accepts_contact=false WHERE id=$1',
        [id],
      );
      await lookup(sender, { plate: vehicle.plate }).expect(200, {
        registered: false,
      });
      await send(sender, { contactToken }).expect(202, receipt);
      await api('delete', '/vehicles/' + id, owner).expect(204);
      await api('post', '/vehicles', outsider).send(vehicle).expect(201);
      await send(sender, { contactToken }).expect(202, receipt);
      expect(await threads(owner)).toEqual([]);
      expect(await threads(outsider)).toEqual([]);
      await send(sender, { contactToken: await plateToken() }).expect(
        202,
        receipt,
      );
      expect(await threads(outsider)).toHaveLength(1);
    });

    it('expires contact tokens without revealing delivery status', async () => {
      await register();
      const contactToken = await plateToken();
      const clock = vi
        .spyOn(Date, 'now')
        .mockReturnValue(Date.now() + 10 * 60 * 1000);
      try {
        await send(sender, { contactToken }).expect(202, receipt);
        expect(await threads(owner)).toEqual([]);
      } finally {
        clock.mockRestore();
      }
    });

    it('preserves legacy opt-outs for both identifiers until the owner re-registers', async () => {
      const id = await register();
      await pool.query(
        'UPDATE contact_vehicles SET accepts_contact=false WHERE id=$1',
        [id],
      );
      for (const identifier of [{ vin: vehicle.vin }, plate]) {
        await lookup(sender, identifier).expect(200, { registered: false });
        await send(sender, identifier).expect(202, receipt);
      }
      expect(await threads(owner)).toEqual([]);
      await api('delete', '/vehicles/' + id, owner).expect(204);
      await register();
      await lookup(sender, plate).expect(200, { registered: true });
      await send(sender, plate).expect(202, receipt);
      expect(await threads(owner)).toHaveLength(1);
    });

    it('charges lookup hits, misses and invalid inputs, separately from send attempts', async () => {
      await register();
      await lookup(sender, { vin: 'BAD' }).expect(400);
      await lookup(sender, { vin: another.vin }).expect(200, {
        registered: false,
      });
      const concurrent = await Promise.all(
        Array.from({ length: 9 }, () => lookup(sender, plate)),
      );
      expect(
        concurrent.filter((response) => response.status === 200),
      ).toHaveLength(8);
      expect(
        concurrent.filter((response) => response.status === 429),
      ).toHaveLength(1);
      await lookup(outsider, plate).expect(200, { registered: true });
      await send(sender, plate).expect(202, receipt);
      expect(await threads(owner)).toHaveLength(1);
    });

    it('limits lookup across accounts sharing a source address', async () => {
      const tokens = await Promise.all(
        Array.from({ length: 4 }, () => account()),
      );
      for (const token of tokens) {
        await Promise.all(
          Array.from({ length: 10 }, () =>
            lookup(token, plate).expect(200, { registered: false }),
          ),
        );
      }
      await lookup(outsider, plate)
        .set('X-Forwarded-For', '192.0.2.10')
        .expect(429);
    });

    it('reveals a thread to the initiator only after a reply and enforces read, report, block and moderation permissions', async () => {
      await register();
      await send(sender, { vin: vehicle.vin }).expect(202, receipt);
      const thread = (await threads(owner))[0];
      expect(Object.keys(thread).sort()).toEqual(['id', 'updatedAt']);
      const path = inbox + '/' + thread.id;
      const messages = async (token: string) =>
        (await api('get', path, token).expect(200)).body.messages as {
          mine: boolean;
          id: string;
          body: string;
          createdAt: string;
        }[];
      const initial = (await messages(owner))[0];
      expect(initial).toEqual({
        id: expect.any(String),
        mine: false,
        body: 'Hello! How much longer will you be charging?',
        createdAt: expect.any(String),
      });
      expect(await threads(sender)).toEqual([]);
      for (const token of [outsider, sender]) {
        await api('get', path, token).expect(404);
        await api('post', path + '/replies', token)
          .send({ message: 'Hello!' })
          .expect(404);
        await api('post', path + '/block', token).expect(404);
      }
      const report = start + '/messages/' + initial.id + '/report';
      await api('post', report, outsider).send({ reason: 'spam' }).expect(404);
      await api('post', report, sender).send({ reason: 'spam' }).expect(404);
      await api('post', path + '/replies', owner)
        .send({ message: 'visit https://example.test' })
        .expect(400);
      await api('post', path + '/replies', owner)
        .send({ message: 'Five minutes.' })
        .expect(201);
      expect((await messages(sender)).map((m) => m.mine)).toEqual([
        true,
        false,
      ]);
      expect(await threads(sender)).toHaveLength(1);
      await api('post', path + '/block', owner).expect(204);
      await lookup(sender, plate).expect(200, { registered: true });
      await api('post', path + '/replies', sender)
        .send({ message: 'Hi!' })
        .expect(403);
      await send(sender, plate).expect(202, receipt);
      await send(sender, { vin: vehicle.vin }).expect(202, receipt);
      expect(await threads(owner)).toHaveLength(1);
      expect(await messages(owner)).toHaveLength(2);
      await send(outsider, plate).expect(202, receipt);
      expect(await threads(owner)).toHaveLength(2);
      await api('post', report, owner).send({ reason: 'spam' }).expect(204);
      await api('post', report, owner).send({ reason: 'spam' }).expect(204);
      await api('get', reports, outsider).expect(403);
      const moderator = await account(true);
      const queue = (await api('get', reports, moderator).expect(200)).body
        .reports as { id: string; message: string }[];
      expect(queue).toHaveLength(1);
      expect(queue[0].message).toBe(initial.body);
      const resolve = reports + '/' + queue[0].id + '/resolve';
      await api('post', resolve, owner).send({ action: 'suspend' }).expect(403);
      await api('post', resolve, moderator)
        .send({ action: 'suspend' })
        .expect(204);
      expect(await messages(owner)).toHaveLength(1);
      await send(sender, { vin: another.vin }).expect(403);
      await api('get', reports, moderator).expect(200, { reports: [] });
    });

    it('charges failed attempts, suppresses repeated open requests and caps incoming traffic across identifiers', async () => {
      await register();
      await send(sender, { vin: vehicle.vin, message: 'Any estimate?' }).expect(
        202,
        receipt,
      );
      for (let n = 0; n < 9; n++)
        await send(sender, n % 2 ? plate : { vin: vehicle.vin }).expect(
          202,
          receipt,
        );
      await send(sender, plate).expect(429);
      expect(await threads(owner)).toHaveLength(1);
      await send(outsider, plate).expect(202, receipt);
      expect(await threads(owner)).toHaveLength(2);
      const others = await Promise.all(
        Array.from({ length: 10 }, () => account()),
      );
      await Promise.all(
        others.map((token, n) =>
          send(token, n % 2 ? plate : { vin: vehicle.vin }).expect(
            202,
            receipt,
          ),
        ),
      );
      expect(await threads(owner)).toHaveLength(10);
      const invalid = await account();
      for (let n = 0; n < 10; n++)
        await send(invalid, { vin: 'BAD' }).expect(400);
      await send(invalid, { vin: another.vin }).expect(429);
    });
    it('serializes reciprocal contacts without exposing a pending outgoing thread', async () => {
      await register();
      await api('post', '/vehicles', sender).send(another).expect(201);
      await Promise.all([
        send(owner, { vin: another.vin }).expect(202, receipt),
        send(sender, plate).expect(202, receipt),
      ]);
      expect(await threads(owner)).toHaveLength(1);
      expect(await threads(sender)).toHaveLength(1);
    });
  },
);
