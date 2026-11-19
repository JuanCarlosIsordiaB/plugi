import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AuthMail } from '../src/auth/auth-mail.service.js';
import { AuthSecrets } from '../src/auth/credentials.js';
import { readLocalWebCors } from '../src/environment.js';

const webOrigin = 'http://localhost:8081';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthMail)
      .useValue({})
      .overrideProvider(AuthSecrets)
      .useValue({})
      .overrideProvider(DatabaseService)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication({
      cors: readLocalWebCors({ WEB_ORIGIN: webOrigin }),
    });
    await app.init();
  });

  it('allows preflight for the configured browser origin', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/v1/auth/2fa/sign-in/123456')
      .set('Origin', webOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-challenge-id')
      .expect(204)
      .expect('Access-Control-Allow-Origin', webOrigin)
      .expect('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
      .expect(
        'Access-Control-Allow-Headers',
        'Authorization,Content-Type,x-challenge-id',
      );
    expect(
      response.headers['access-control-allow-credentials'],
    ).toBeUndefined();
  });

  it('allows vehicle removal preflight for the configured browser origin', async () => {
    await request(app.getHttpServer())
      .options('/api/v1/vehicles/51ccbaec-5dd1-4a7c-9433-23bbf86e718d')
      .set('Origin', webOrigin)
      .set('Access-Control-Request-Method', 'DELETE')
      .set('Access-Control-Request-Headers', 'authorization')
      .expect(204)
      .expect('Access-Control-Allow-Origin', webOrigin)
      .expect('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  });

  it('withholds browser access from another local port', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/v1/station-proposals')
      .set('Origin', 'http://localhost:8082')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
