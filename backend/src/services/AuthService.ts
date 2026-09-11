import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { db, transaction } from '../config/database.js';
import { newToken, hashToken } from '../utils/encrypt.js';
import { AppError } from '../utils/errors.js';
import type { User } from '../models/types.js';
import { LDAPService } from './LDAPService.js';
export class AuthService {
  async login(
    username: string,
    password: string,
    source: 'local' | 'ldap' = 'local',
  ): Promise<User> {
    if (source === 'ldap') {
      try {
        return await new LDAPService().authenticate(username, password);
      } catch (e) {
        if (e instanceof AppError && e.statusCode === 401) throw e;
        throw new AppError(
          503,
          'LDAP unavailable; use local sign-in for an existing local account',
        );
      }
    }
    const r = await db.query<User>("SELECT * FROM users WHERE email=$1 AND source='local'", [
      username.toLowerCase(),
    ]);
    const user = r.rows[0];
    const fallback =
      '$argon2id$v=19$m=65536,t=3,p=4$MTIzNDU2Nzg5MGFiY2RlZg$H6PEPBEiQMhXAWdrG5kTF5Ll8dPmwgXLcdDZvDAFVpo';
    const valid = await argon2.verify(user?.password_hash ?? fallback, password).catch(() => false);
    if (!user || !user.active || !valid) throw new AppError(401, 'Invalid credentials');
    return user;
  }
  async createRefresh(userId: string, family = randomUUID()) {
    const token = newToken();
    await db.query(
      "INSERT INTO refresh_tokens(user_id,token_hash,family_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [userId, hashToken(token), family],
    );
    return token;
  }
  async rotate(token: string): Promise<{ user: User; refreshToken: string }> {
    const outcome = await transaction(async (c) => {
      const r = await c.query('SELECT * FROM refresh_tokens WHERE token_hash=$1 FOR UPDATE', [
        hashToken(token),
      ]);
      const old = r.rows[0];
      if (!old) return null;
      if (old.revoked_at) {
        await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE family_id=$1', [
          old.family_id,
        ]);
        return null;
      }
      if (new Date(old.expires_at) <= new Date()) return null;
      const users = await c.query<User>('SELECT * FROM users WHERE id=$1 AND active=true', [
        old.user_id,
      ]);
      const user = users.rows[0];
      if (!user) return null;
      await c.query('UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1', [old.id]);
      const refreshToken = newToken();
      await c.query(
        "INSERT INTO refresh_tokens(user_id,token_hash,family_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
        [user.id, hashToken(refreshToken), old.family_id],
      );
      return { user, refreshToken };
    });
    if (!outcome) throw new AppError(401, 'Invalid or reused refresh token');
    return outcome;
  }
  async logout(token: string) {
    await db.query(
      'UPDATE refresh_tokens SET revoked_at=now() WHERE family_id=(SELECT family_id FROM refresh_tokens WHERE token_hash=$1)',
      [hashToken(token)],
    );
  }
}
