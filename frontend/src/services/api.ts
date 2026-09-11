export interface Identity {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'readonly';
}
let accessToken = '';
let refreshPromise: Promise<boolean> | null = null;
export const getAccessToken = () => accessToken;
export function setAccessToken(token: string) {
  accessToken = token;
}
async function refresh() {
  if (!refreshPromise)
    refreshPromise = (async () => {
      try {
        const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
        if (!r.ok) return false;
        const b = await r.json();
        accessToken = b.accessToken;
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  return refreshPromise;
}
export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch('/api/v1' + path, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('No se puede conectar con NEXUS. Comprueba que la API está en ejecución.');
  }
  if (r.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refresh()) return api(path, options, false);
    window.dispatchEvent(new Event('nexus:unauthorized'));
  }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(
      e.issues
        ?.map((i: { path: string[]; message: string }) => i.path.join('.') + ': ' + i.message)
        .join('; ') ??
        e.error ??
        `Error ${r.status}`,
    );
  }
  if (r.headers.get('content-type')?.includes('application/octet-stream'))
    return (await r.blob()) as T;
  return (await r.json()) as T;
}
export const post = <T = unknown>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export async function download(path: string, name: string) {
  const blob = await api<Blob>(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
