import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import type { PoolClient } from 'pg';
import { AuthSecrets } from './credentials.js';
import { Sessions, type UserRow } from './session.service.js';

@Injectable()
export class TotpService {
  constructor(
    @Inject(AuthSecrets) private readonly secrets: AuthSecrets,
    @Inject(Sessions) private readonly sessions: Sessions,
  ) {}

  private totp(user: UserRow, secret: string) {
    return new TOTP({
      issuer: 'buscaPila',
      label: user.email,
      secret,
      digits: 6,
      period: 30,
      algorithm: 'SHA1',
    });
  }

  async accept(client: PoolClient, user: UserRow, code: string) {
    if (!user.totp_secret)
      throw new UnauthorizedException('Invalid authenticator code.');
    const timestamp = Date.now();
    const totp = this.totp(user, this.secrets.open(user.totp_secret));
    const delta = totp.validate({ token: code, window: 1, timestamp });
    const step = Math.floor(timestamp / 30000) + (delta ?? 0);
    if (delta === null || step <= Number(user.totp_last_step ?? -1))
      throw new UnauthorizedException(
        'Invalid or already used authenticator code.',
      );
    await client.query('UPDATE auth_users SET totp_last_step=$2 WHERE id=$1', [
      user.id,
      step,
    ]);
  }

  setup(header?: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      if (user.totp_enabled)
        throw new BadRequestException(
          'Two-factor authentication is already enabled.',
        );
      const secret = new Secret({ size: 20 }).base32;
      const qrCode = await QRCode.toDataURL(this.totp(user, secret).toString());
      await client.query(
        `UPDATE auth_users SET totp_secret=$2,totp_last_step=NULL,
        totp_setup_expires_at=now()+interval '15 minutes' WHERE id=$1`,
        [user.id, this.secrets.seal(secret)],
      );
      return { secret, qrCode };
    });
  }

  change(header: string | undefined, code: string, enable: boolean) {
    return this.sessions.authenticated(header, async (client, user) => {
      if (user.totp_enabled === enable)
        throw new BadRequestException(
          'Two-factor authentication is already in the requested state.',
        );
      if (
        enable &&
        (!user.totp_setup_expires_at ||
          user.totp_setup_expires_at.getTime() <= Date.now())
      )
        throw new BadRequestException('Authenticator setup expired.');
      await this.accept(client, user, code);
      await client.query(
        `UPDATE auth_users SET totp_enabled=$2, totp_setup_expires_at=NULL,
        totp_secret=CASE WHEN $2 THEN totp_secret ELSE NULL END, updated_at=now() WHERE id=$1`,
        [user.id, enable],
      );
      await client.query(
        "DELETE FROM auth_challenges WHERE user_id=$1 AND kind='2fa'",
        [user.id],
      );
      return {
        msg: enable
          ? 'Two-factor authentication enabled.'
          : 'Two-factor authentication disabled.',
      };
    });
  }
}
