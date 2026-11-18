import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private closing?: Promise<void>;

  constructor(private readonly pool: Pool) {
    this.pool.on('error', () => {
      this.logger.error('An idle PostgreSQL client disconnected unexpectedly.');
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      const startupProbe = { text: 'SELECT 1', query_timeout: 5_000 };
      await this.pool.query(startupProbe);
    } catch {
      await this.onApplicationShutdown().catch(() => {
        this.logger.error('Could not close the PostgreSQL pool.');
      });
      throw new Error('Could not verify the PostgreSQL connection at startup.');
    }
  }

  onApplicationShutdown(): Promise<void> {
    return (this.closing ??= this.pool.end().catch(() => {
      throw new Error('Could not close the PostgreSQL pool.');
    }));
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {
        discard = true;
      });
      throw error;
    } finally {
      client.release(discard);
    }
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(text, [...values]);
  }
}
