import { config } from 'dotenv';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
config({ quiet: true });
const port = process.env.NEXUS_HTTP_PORT || '8080';
const origin = `http://localhost:${port}`;
const response = await fetch(origin);
assert.equal(response.status, 200, 'Frontend must serve its index');
const login = await fetch(origin + '/api/v1/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin },
  body: JSON.stringify({ username: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
});
assert.equal(login.status, 200, 'Bootstrap administrator must be able to sign in');
const cookie = login.headers.get('set-cookie');
assert.match(cookie, /HttpOnly/i);
assert.ok(
  !/;\s*Secure/i.test(cookie),
  'Local HTTP session must use its explicit development cookie settings',
);
const { accessToken } = await login.json();
const me = await fetch(origin + '/api/v1/auth/me', {
  headers: { authorization: `Bearer ${accessToken}` },
});
assert.equal(me.status, 200);
assert.equal((await me.json()).role, 'admin');
const refresh = await fetch(origin + '/api/v1/auth/refresh', {
  method: 'POST',
  headers: { origin, cookie: cookie.split(';')[0] },
});
assert.equal(refresh.status, 200, 'Refresh must work through the reverse proxy');
const socket = io(origin, {
  auth: { token: accessToken },
  transports: ['websocket'],
  extraHeaders: { Origin: origin },
  reconnection: false,
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket handshake timed out')), 10000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(new Error(error.message));
    });
  });
} finally {
  socket.disconnect();
}
console.log(
  'Compose passed: frontend, automatic admin bootstrap, login, refresh, RBAC identity and WebSocket proxy.',
);
