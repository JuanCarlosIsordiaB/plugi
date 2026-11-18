import { Logger } from '@nestjs/common';
import { Pool, type QueryConfig, type QueryResult } from 'pg';
import { DatabaseService } from './database.service.js';

describe('DatabaseService', () => {
  let pool: Pool;
  let service: DatabaseService;
  // Select the promise overload used by DatabaseService for the Vitest spies.
  let queryTarget: {
    query(
      textOrConfig: string | QueryConfig,
      values?: unknown[],
    ): Promise<Pick<QueryResult, 'rows'>>;
  };

  beforeEach(() => {
    pool = new Pool();
    service = new DatabaseService(pool);
    queryTarget = pool;
  });

  afterEach(async () => {
    try {
      await service.onApplicationShutdown();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('checks PostgreSQL with a startup timeout and drains the pool on shutdown', async () => {
    const query = vi
      .spyOn(queryTarget, 'query')
      .mockResolvedValue({ rows: [] });
    const end = vi.spyOn(pool, 'end');

    await service.onModuleInit();
    expect(query).toHaveBeenCalledWith({
      text: 'SELECT 1',
      query_timeout: 5_000,
    });

    await Promise.all([
      service.onApplicationShutdown(),
      service.onApplicationShutdown(),
    ]);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('rejects startup with a sanitized error and closes the pool on query failure', async () => {
    const rawError = new Error('Connection error with private server details');
    vi.spyOn(queryTarget, 'query').mockRejectedValue(rawError);
    const end = vi.spyOn(pool, 'end');

    await expect(service.onModuleInit()).rejects.toThrow(
      /^Could not verify the PostgreSQL connection at startup\.$/,
    );
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('logs idle client errors without recording server details', () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    pool.emit('error', new Error('Private server details'));

    expect(log).toHaveBeenCalledExactlyOnceWith(
      'An idle PostgreSQL client disconnected unexpectedly.',
    );
  });

  it('forwards parameter values separately from query text', async () => {
    const result = { rows: [{ value: "O'Reilly" }] };
    const query = vi.spyOn(queryTarget, 'query').mockResolvedValue(result);

    await expect(
      service.query('SELECT $1::text AS value', ["O'Reilly"]),
    ).resolves.toBe(result);
    expect(query).toHaveBeenCalledWith('SELECT $1::text AS value', [
      "O'Reilly",
    ]);
  });
});
