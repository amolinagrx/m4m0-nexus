import { randomBytes, createCipheriv, createDecipheriv, createHash, scryptSync } from 'node:crypto';
export function encrypt(value: string, key: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join('.');
}
export function decrypt(value: string, key: string): string {
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined)
    throw new Error('Invalid encrypted envelope');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');
export function passwordEncrypt(value: string, password: string): Buffer {
  const salt = randomBytes(16);
  return Buffer.from(
    JSON.stringify({
      version: 1,
      salt: salt.toString('hex'),
      data: encrypt(value, scryptSync(password, salt, 32).toString('hex')),
    }),
  );
}
export function passwordDecrypt(value: Buffer, password: string): string {
  const e = JSON.parse(value.toString()) as { version: number; salt: string; data: string };
  if (e.version !== 1 || !/^[a-f0-9]{32}$/.test(e.salt)) throw new Error('Invalid envelope');
  return decrypt(e.data, scryptSync(password, Buffer.from(e.salt, 'hex'), 32).toString('hex'));
}
