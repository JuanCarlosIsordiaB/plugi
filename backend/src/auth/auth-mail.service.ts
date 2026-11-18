import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class AuthMail {
  private readonly from = process.env.RESEND_FROM_EMAIL?.trim();
  private readonly key = process.env.RESEND_API_KEY?.trim();

  constructor() {
    if (
      !this.key ||
      !this.from ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(this.from)
    ) {
      throw new Error(
        'Set RESEND_API_KEY and RESEND_FROM_EMAIL to enable authentication mail.',
      );
    }
  }

  async send(
    to: string,
    kind: 'account_confirmation' | 'password_reset',
    code: string,
  ): Promise<void> {
    const verification = kind === 'account_confirmation';
    try {
      const result = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + this.key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'buscaPila <' + this.from + '>',
          to: [to],
          subject: verification
            ? 'Verify your buscaPila email'
            : 'Reset your buscaPila password',
          text:
            (verification
              ? 'Enter this verification code in buscaPila: '
              : 'Enter this password reset token in buscaPila: ') +
            code +
            '\nIt expires in 15 minutes.',
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!result.ok) throw new Error('Mail provider rejected the request.');
    } catch {
      throw new ServiceUnavailableException(
        'Email delivery is temporarily unavailable.',
      );
    }
  }
}
