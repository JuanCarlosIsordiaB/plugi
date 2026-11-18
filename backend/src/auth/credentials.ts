import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return [
    'scrypt-v1',
    salt,
    (await derive(password, salt)).toString('hex'),
  ].join('$');
}

export async function matchesPassword(
  password: string,
  encoded?: string,
): Promise<boolean> {
  const [version, salt, hash] = (encoded ?? '').split('$');
  // Perform the same work for unknown email addresses.
  const actual = await derive(
    password,
    salt || '00000000000000000000000000000000',
  );
  return (
    version === 'scrypt-v1' &&
    hash?.length === 128 &&
    timingSafeEqual(actual, Buffer.from(hash, 'hex'))
  );
}

export function bearer(header?: string): string {
  const value = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(header ?? '')?.[1];
  if (!value) throw new UnauthorizedException('Invalid or expired token.');
  return value;
}

@Injectable()
export class AuthSecrets {
  private readonly key: Buffer;

  constructor() {
    const value = process.env.AUTH_ENCRYPTION_KEY ?? '';
    if (!/^[\da-f]{64}$/i.test(value))
      throw new Error(
        'AUTH_ENCRYPTION_KEY must contain 64 hexadecimal characters.',
      );
    this.key = Buffer.from(value, 'hex');
  }

  codeHash(id: string, code: string): string {
    return createHmac('sha256', this.key)
      .update('challenge:' + id + ':' + code)
      .digest('hex');
  }

  seal(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString('base64'))
      .join('.');
  }

  open(sealed: string): string {
    const [iv, tag, ciphertext] = sealed
      .split('.')
      .map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
