import pino from 'pino';
export const logger = pino({
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'secret',
      'credentials',
    ],
    censor: '[REDACTED]',
  },
});
