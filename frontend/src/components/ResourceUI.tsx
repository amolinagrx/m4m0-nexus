import { useState, type FormEvent } from 'react';
import { Check, RefreshCw, Layers3 } from 'lucide-react';
import { Button } from './ui/button';
import type { Row } from '../services/demo';
export function Badge({ value }: { value: unknown }) {
  const text = String(value ?? '—');
  const good = [
    'connected',
    'running',
    'online',
    'completed',
    'true',
    'active',
    'admin',
    'ready',
  ].includes(text.toLowerCase());
  const bad = ['error', 'failed', 'offline'].includes(text.toLowerCase());
  const labels: Record<string, string> = {
    connected: 'Conectado',
    running: 'En ejecución',
    stopped: 'Detenida',
    completed: 'Completado',
    true: 'Activo',
    false: 'Inactivo',
    pending: 'Pendiente',
    error: 'Sin conexión',
  };
  return (
    <span className={`badge ${good ? 'good' : bad ? 'bad' : 'neutral'}`}>
      <i />
      {labels[text] ?? text}
    </span>
  );
}
export function Provider({ type }: { type: unknown }) {
  const labels: Record<string, string> = {
    proxmox: 'Proxmox',
    kubernetes: 'Kubernetes',
    xcpng: 'XCP-ng',
    citrix: 'Citrix',
    vmware: 'VMware',
  };
  return <span className={'provider ' + String(type)}>{labels[String(type)] ?? String(type)}</span>;
}
export function Empty({
  title = 'No hay recursos',
  text = 'Añade una infraestructura para empezar a trabajar.',
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="empty">
      <Layers3 size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Cell({ name, value }: { name: string; value: unknown }) {
  if (['state', 'status', 'active', 'role'].includes(name)) return <Badge value={value} />;
  if (name === 'type' || name === 'infrastructure_type') return <Provider type={value} />;
  if (name === 'memory_mb') return <span className="mono">{Number(value) / 1024} GB</span>;
  if (name === 'backup_size_bytes') return <span>{(Number(value) / 1024).toFixed(1)} KB</span>;
  if (name.endsWith('_at') || name === 'last_sync' || name === 'last_run')
    return (
      <span className="muted">
        {value
          ? new Date(String(value)).toLocaleString('es-ES', {
              month: 'short',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '—'}
      </span>
    );
  if (Array.isArray(value)) return <span className="muted">{value.join(', ')}</span>;
  return (
    <span className={name === 'name' ? 'resource-name' : name === 'host' ? 'mono muted' : ''}>
      {value === null || value === undefined ? '—' : String(value)}
    </span>
  );
}
export type Field = {
  key: string;
  label: string;
  type?: string;
  options?: string[];
  initial?: unknown;
  required?: boolean;
  hint?: string;
};
export function Fields({
  fields,
  submit,
  label = 'Guardar',
  initial = {},
}: {
  fields: Field[];
  submit: (v: Row) => Promise<void>;
  label?: string;
  initial?: Row;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const data = new FormData(e.currentTarget);
    const values: Row = {};
    for (const f of fields) {
      const v = data.get(f.key);
      values[f.key] =
        f.type === 'checkbox' ? v === 'on' : f.type === 'number' ? Number(v) : (v ?? '');
    }
    try {
      await submit(values);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="fields">
      {fields.map((f) => (
        <label key={f.key} className={f.type === 'checkbox' ? 'check-field' : ''}>
          <span>{f.label}</span>
          {f.options ? (
            <select name={f.key} defaultValue={String(initial[f.key] ?? f.initial ?? f.options[0])}>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : f.type === 'textarea' ? (
            <textarea
              name={f.key}
              rows={3}
              defaultValue={String(initial[f.key] ?? f.initial ?? '')}
              required={f.required}
            />
          ) : f.type === 'checkbox' ? (
            <input
              name={f.key}
              type="checkbox"
              defaultChecked={Boolean(initial[f.key] ?? f.initial)}
            />
          ) : (
            <input
              name={f.key}
              type={f.type ?? 'text'}
              defaultValue={String(initial[f.key] ?? f.initial ?? '')}
              required={f.required}
              autoComplete={f.type === 'password' ? 'new-password' : 'off'}
            />
          )}{' '}
          {f.hint && <small>{f.hint}</small>}
        </label>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? <RefreshCw className="spin" size={16} /> : <Check size={16} />}{' '}
        {busy ? 'Procesando…' : label}
      </Button>
    </form>
  );
}
