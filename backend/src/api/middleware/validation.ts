import { z } from 'zod';
export const idParam = z.object({ id: z.string().uuid() });
export const nameSchema = z.string().trim().min(1).max(120);
export const httpsURL = z
  .string()
  .url()
  .refine((v) => {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash;
  }, 'An HTTPS URL without embedded credentials is required');
