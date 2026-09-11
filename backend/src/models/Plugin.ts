export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entryPoint: string;
  hooks: { event: string; handler: (data: unknown) => Promise<unknown> }[];
  settings?: {
    key: string;
    type: 'string' | 'number' | 'boolean' | 'select';
    label: string;
    default: unknown;
    options?: unknown[];
  }[];
}
