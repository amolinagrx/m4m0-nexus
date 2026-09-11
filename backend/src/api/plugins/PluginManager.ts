import { fork, type ChildProcess } from 'node:child_process';
import { realpath, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import { audit } from '../../services/AuditService.js';
import { AppError } from '../../utils/errors.js';
const manifest = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,60}$/),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string(),
  entryPoint: z.literal('index.js'),
});
export class PluginManager {
  async install(id: string) {
    if (!/^[a-z][a-z0-9-]{1,60}$/.test(id)) throw new AppError(400, 'Invalid plugin ID');
    const base = await realpath(env.PLUGIN_DIR),
      dir = await realpath(resolve(base, id));
    if (!dir.startsWith(base + sep))
      throw new AppError(400, 'Plugin path outside approved directory');
    const m = manifest.parse(JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8')));
    if (m.id !== id) throw new AppError(400, 'Plugin identity mismatch');
    const file = await realpath(resolve(dir, m.entryPoint));
    if (!file.startsWith(dir + sep)) throw new AppError(400, 'Plugin entry path invalid');
    await db.query(
      'INSERT INTO plugins(id,name,version,description,author,entry_point) VALUES($1,$2,$3,$4,$5,$6)',
      [m.id, m.name, m.version, m.description, m.author, file],
    );
    return m;
  }
  async emit(event: string, data: unknown) {
    const rows = await db.query('SELECT id,entry_point,config FROM plugins WHERE active=true');
    for (const p of rows.rows) {
      try {
        await this.run(p.entry_point, event, data, p.config);
        await audit(null, 'plugin.hook.completed', 'plugin:' + p.id, null, { event });
      } catch (e) {
        await audit(null, 'plugin.hook.failed', 'plugin:' + p.id, null, { event });
        throw e;
      }
    }
  }
  private async run(entry: string, event: string, data: unknown, config: unknown) {
    await new Promise<void>((resolvePromise, reject) => {
      const child: ChildProcess = fork(
        new URL(
          env.NODE_ENV === 'production'
            ? './plugin-runner.js'
            : '../../../dist/api/plugins/plugin-runner.js',
          import.meta.url,
        ),
        [],
        {
          env: { NODE_ENV: 'production' },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          execArgv: ['--max-old-space-size=64'],
        },
      );
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new AppError(504, 'Plugin hook timeout'));
      }, 5000);
      child.once('message', (m: unknown) => {
        clearTimeout(timer);
        child.kill();
        if ((m as { ok: boolean }).ok) resolvePromise();
        else reject(new AppError(502, 'Plugin hook failed'));
      });
      child.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new AppError(502, `Plugin exited (${code})`));
      });
      child.send({ url: pathToFileURL(entry).href, event, data, config });
    });
  }
}
