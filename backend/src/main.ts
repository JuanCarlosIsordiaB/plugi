import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadBackendEnv, readLocalWebCors } from './environment.js';

async function bootstrap() {
  loadBackendEnv();
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    cors: readLocalWebCors(process.env),
  });
  app.enableShutdownHooks();

  try {
    await app.listen(process.env.PORT ?? 3000);
  } catch (error) {
    await app.close().catch(() => {
      Logger.error(
        'Could not complete application shutdown after startup failed.',
      );
    });
    throw error;
  }
}
await bootstrap();
