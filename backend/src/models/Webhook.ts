import type { WebhookEvent } from './types.js';
export interface Webhook {
  id: string;
  name: string;
  url: string;
  method: 'POST' | 'GET' | 'PUT';
  headers?: Record<string, string>;
  events: WebhookEvent[];
  active: boolean;
  secret?: string;
  retryCount: number;
  timeout: number;
  createdAt: Date;
}
