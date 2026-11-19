import { loadEnvFile } from 'node:process';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

export function loadBackendEnv(): void {
  try {
    loadEnvFile(new URL('../.env', import.meta.url));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('Could not load backend/.env.');
    }
  }
}

export function readLocalWebCors(env: NodeJS.ProcessEnv): CorsOptions | false {
  const origin = env.WEB_ORIGIN;
  if (!origin || env.NODE_ENV === 'production') return false;

  const url = URL.parse(origin);
  if (
    !url ||
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.origin !== origin
  ) {
    throw new Error(
      'WEB_ORIGIN must be an exact loopback HTTP origin such as http://localhost:8081.',
    );
  }
  return {
    origin: [origin],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'x-challenge-id'],
    credentials: false,
  };
}
