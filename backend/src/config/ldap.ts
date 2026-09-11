import { z } from 'zod';
export const ldapSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith('ldaps://'), 'LDAPS required'),
    bindDN: z.string().min(1),
    bindCredentials: z.string().min(1),
    searchBase: z.string().min(1),
    searchFilter: z.string().default('(objectClass=person)'),
    usernameAttribute: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9-]*$/)
      .default('uid'),
    emailAttribute: z.string().default('mail'),
    groupAttribute: z.string().default('memberOf'),
    tlsEnabled: z.literal(true).default(true),
    caCert: z.string().optional(),
    groupMapping: z.record(z.enum(['admin', 'user', 'readonly'])).default({}),
    syncInterval: z.number().int().min(300).default(3600),
    active: z.boolean().default(false),
  })
  .strict();
export type LDAPConfig = z.infer<typeof ldapSchema>;
