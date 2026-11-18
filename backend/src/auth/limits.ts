import { randomInt } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { DatabaseService } from '../database/database.service.js';
import { digest } from './credentials.js';
import { emailField } from './input.js';

interface Rule {
  name: string;
  max: number;
  seconds: number;
  mailboxMax?: number;
}
const key = 'buscapila.auth.limit';
export const Limit = (
  name: string,
  max: number,
  seconds: number,
  mailboxMax?: number,
) => SetMetadata(key, { name, max, seconds, mailboxMax });
@Injectable()
export class AuthLimit implements CanActivate {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<Rule>(key, context.getHandler()) ?? {
      name: 'session',
      max: 120,
      seconds: 60,
    };
    const req = context.switchToHttp().getRequest<Request>();
    context
      .switchToHttp()
      .getResponse<Response>()
      .set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    await this.check(rule, 'ip:' + (req.ip ?? req.socket.remoteAddress));
    if (rule.mailboxMax) {
      const email = emailField(
        (req.body as { email?: unknown } | undefined)?.email,
      );
      await this.check({ ...rule, max: rule.mailboxMax }, 'email:' + email);
    }
    const id = req.get('x-challenge-id');
    if (id && /^[\da-f-]{36}$/i.test(id))
      await this.check(rule, 'challenge:' + id.toLowerCase());
    if (randomInt(128) === 0) {
      await this.db.query(
        'DELETE FROM auth_rate_limits WHERE expires_at<=now()',
      );
      await this.db.query(
        'DELETE FROM auth_challenges WHERE expires_at<=now()',
      );
      await this.db.query('DELETE FROM auth_sessions WHERE expires_at<=now()');
    }
    return true;
  }

  private async check(rule: Rule, subject: string) {
    const result = await this.db.query<{ hits: number }>(
      `INSERT INTO auth_rate_limits AS r (bucket,hits,expires_at)
      VALUES ($1,1,now()+$2::int*interval '1 second') ON CONFLICT(bucket) DO UPDATE SET
      hits=CASE WHEN r.expires_at<=now() THEN 1 ELSE LEAST(r.hits+1,$3+1) END,
      expires_at=CASE WHEN r.expires_at<=now() THEN EXCLUDED.expires_at ELSE r.expires_at END RETURNING hits`,
      [digest(rule.name + ':' + subject), rule.seconds, rule.max],
    );
    if (result.rows[0].hits > rule.max)
      throw new HttpException(
        'Too many requests. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }
}
