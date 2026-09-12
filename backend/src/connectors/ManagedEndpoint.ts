import { Agent, fetch } from 'undici';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';

export const managedEndpoint = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === '/'
    );
  }, 'Use an HTTPS origin without path, query or credentials');
export const remoteId = z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/);
export interface EndpointCredentials {
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  apiKey?: string;
}

/** A bounded, non-redirecting transport. Provider response bodies never become public errors. */
export class ManagedEndpoint {
  private readonly agent: Agent;
  private readonly origin: string;
  constructor(
    endpoint: string,
    private readonly credentials: EndpointCredentials,
    private readonly provider: string,
  ) {
    this.origin = new URL(managedEndpoint.parse(endpoint)).origin;
    this.agent = new Agent({
      connect: {
        rejectUnauthorized: true,
        ca: credentials.caCert || undefined,
        cert: credentials.clientCert || undefined,
        key: credentials.clientKey || undefined,
      },
    });
  }
  async bytes(method: string, path: string, body?: unknown): Promise<Buffer> {
    try {
      const response = await fetch(this.origin + path, {
        method,
        dispatcher: this.agent,
        redirect: 'error',
        signal: AbortSignal.timeout(45000),
        headers: {
          ...(this.credentials.apiKey ? { 'x-api-key': this.credentials.apiKey } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const status = response.status === 404 ? 404 : response.status === 409 ? 409 : 502;
        throw new AppError(status, `${this.provider} returned HTTP ${response.status}`);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      if (response.body)
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024)
            throw new AppError(502, `${this.provider} response exceeds 8 MB`);
          chunks.push(Buffer.from(chunk));
        }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        `${this.provider} connection failed; check endpoint, certificate and credentials`,
      );
    }
  }
  async json<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const bytes = await this.bytes(method, path, body);
    if (!bytes.length) return undefined as T;
    try {
      return JSON.parse(bytes.toString()) as T;
    } catch {
      throw new AppError(502, `${this.provider} returned invalid JSON`);
    }
  }
  async close() {
    await this.agent.close();
  }
}
