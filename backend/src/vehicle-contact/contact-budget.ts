import { HttpException, HttpStatus } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { digest } from '../auth/credentials.js';

// Reuse the expiring, hashed buckets cleaned by AuthLimit.
export async function consumeBudget(
  client: PoolClient,
  scope: string,
  subject: string,
  maximum: number,
) {
  const result = await client.query<{ hits: number }>(
    `INSERT INTO auth_rate_limits AS r(bucket,hits,expires_at)
     VALUES ($1,1,clock_timestamp()+interval '1 hour')
     ON CONFLICT(bucket) DO UPDATE SET
       hits=CASE WHEN r.expires_at<=clock_timestamp() THEN 1 ELSE LEAST(r.hits+1,$2::int+1) END,
       expires_at=CASE WHEN r.expires_at<=clock_timestamp() THEN EXCLUDED.expires_at ELSE r.expires_at END
     RETURNING hits`,
    [digest('vehicle-contact:' + scope + ':' + subject), maximum],
  );
  return result.rows[0].hits <= maximum;
}
export function limited(): never {
  throw new HttpException(
    'Too many requests. Try again later.',
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
