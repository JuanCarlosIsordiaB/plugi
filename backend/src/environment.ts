import { loadEnvFile } from 'node:process';

export function loadBackendEnv(): void {
  try {
    loadEnvFile(new URL('../.env', import.meta.url));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('Could not load backend/.env.');
    }
  }
}
