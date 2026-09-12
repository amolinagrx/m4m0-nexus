import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Play, Pencil, Trash2, ExternalLink, Database } from 'lucide-react';
import { api, post } from '../../services/api';
import { Empty, Badge, Fields, type Field } from '../../components/ResourceUI';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import type { DockerHost } from '../Docker';
interface Instance {
  id: string;
  name: string;
  endpoint: string;
  docker_host_id: string;
  status: string;
}
interface Job {
  shortId: string;
  name: string;
  volumeId: number;
  repositoryId: string;
  enabled: boolean;
  cronExpression: string;
  retentionPolicy: { keepLast?: number } | null;
  includePaths: string[] | null;
  excludePatterns: string[] | null;
  lastBackupAt: number | null;
  nextBackupAt: number | null;
  lastBackupStatus: string | null;
  volume?: { name: string };
  repository?: { name: string };
}
interface Resources {
  volumes: { id: number; shortId: string; name: string }[];
  repositories: { id: string; shortId: string; name: string }[];
}
interface History {
  items: {
    id: string;
    kind: string;
    status: string;
    startedAt?: number | null;
    finishedAt?: number | null;
    outcome?: string | null;
  }[];
}
interface Snapshot {
  short_id: string;
  time: number;
  size: number;
  paths: string[];
}
const date = (v?: number | null) => (v ? new Date(v).toLocaleString('es-ES') : '—');
export default function ZerobyteView({
  demo,
  revision: externalRevision,
  notify,
}: {
  demo: boolean;
  revision: number;
  notify: (m: string) => void;
}) {
  const [instances, setInstances] = useState<Instance[]>([]),
    [hosts, setHosts] = useState<DockerHost[]>([]),
    [selected, setSelected] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]),
    [resources, setResources] = useState<Resources>({ volumes: [], repositories: [] }),
    [history, setHistory] = useState<History>({ items: [] });
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0),
    [dialog, setDialog] = useState(''),
    [editing, setEditing] = useState<Job | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]),
    [repository, setRepository] = useState('');
  const [confirm, setConfirm] = useState<{
      title: string;
      description: string;
      action: () => Promise<unknown>;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const instance = instances.find((i) => i.id === selected);
  const base = `/zerobyte/instances/${selected}`;
  const refresh = () => setRevision((r) => r + 1);
  useEffect(() => {
    if (demo) return;
    let active = true;
    void Promise.all([api<Instance[]>('/zerobyte/instances'), api<DockerHost[]>('/docker/hosts')])
      .then(([i, h]) => {
        if (active) {
          setInstances(i);
          setHosts(h);
          setSelected((s) => (i.some((x) => x.id === s) ? s : (i[0]?.id ?? '')));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [demo, revision, externalRevision]);
  useEffect(() => {
    setJobs([]);
    setResources({ volumes: [], repositories: [] });
    setHistory({ items: [] });
    setError('');
    if (demo || !selected) return;
    let active = true;
    setLoading(true);
    void Promise.all([
      api<Job[]>(base + '/jobs'),
      api<Resources>(base + '/resources'),
      api<History>(base + '/history'),
    ])
      .then(([j, r, h]) => {
        if (active) {
          setJobs(j);
          setResources(r);
          setHistory(h);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [demo, selected, revision, externalRevision]);
  useEffect(() => {
    setSnapshots([]);
    setRepository('');
  }, [selected]);
  const connectionFields: Field[] = [
    { key: 'name', label: 'Nombre', required: true },
    {
      key: 'endpoint',
      label: 'URL HTTPS de Zerobyte',
      type: 'url',
      required: true,
      hint: 'Origen sin /api/v1; por ejemplo https://backups.example.com',
    },
    {
      key: 'dockerHostId',
      label: 'Host Docker cuyos datos protege',
      options: hosts.map((h) => h.id),
      optionLabels: Object.fromEntries(hosts.map((h) => [h.id, h.name])),
      required: true,
    },
    { key: 'apiKey', label: 'API key de Zerobyte', type: 'password' },
    { key: 'caCert', label: 'Certificado CA privado (opcional, PEM)', type: 'textarea' },
  ];
  const jobFields: Field[] = [
    { key: 'name', label: 'Nombre del trabajo', required: true },
    {
      key: 'volumeId',
      label: 'Origen de datos en Zerobyte',
      options: resources.volumes.map((v) => v.shortId),
      optionLabels: Object.fromEntries(resources.volumes.map((v) => [v.shortId, v.name])),
      required: true,
      hint: 'Debe contener los datos persistentes del host Docker asociado. Al editar no se puede cambiar el origen.',
    },
    {
      key: 'repositoryId',
      label: 'Repositorio de destino',
      options: resources.repositories.map((r) => r.id),
      optionLabels: Object.fromEntries(resources.repositories.map((r) => [r.id, r.name])),
      required: true,
    },
    {
      key: 'cronExpression',
      label: 'Programación cron (zona horaria de Zerobyte)',
      initial: '0 2 * * *',
      required: true,
    },
    {
      key: 'keepLast',
      label: 'Conservar las últimas copias',
      type: 'number',
      initial: 7,
      required: true,
    },
    {
      key: 'includePaths',
      label: 'Rutas incluidas (una por línea; vacío = todo el origen)',
      type: 'textarea',
    },
    { key: 'excludePatterns', label: 'Patrones excluidos (uno por línea)', type: 'textarea' },
    { key: 'enabled', label: 'Programación activa', type: 'checkbox', initial: true },
  ];
  if (demo)
    return (
      <Empty
        title="Backups Docker con Zerobyte"
        text="Conecta tu entorno, registra un host Docker y añade tu instancia Zerobyte para gestionar sus trabajos de copia."
      />
    );
  return (
    <div className="container-management">
      <div className="panel management-toolbar">
        <label>
          Instancia Zerobyte
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Selecciona una instancia</option>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" disabled={loading} onClick={refresh}>
          <RefreshCw size={16} />
          Actualizar
        </Button>
        <Button disabled={!hosts.length} onClick={() => setDialog('connection')}>
          <Plus size={16} />
          Conectar Zerobyte
        </Button>
        {instance && (
          <>
            <Button variant="ghost" onClick={() => setDialog('edit-connection')}>
              <Pencil size={16} />
              Editar conexión
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                setConfirm({
                  title: 'Desvincular Zerobyte',
                  description:
                    'Se retira la conexión de NEXUS. Los trabajos y sus copias permanecen en Zerobyte.',
                  action: () => api(base, { method: 'DELETE' }),
                })
              }
            >
              Desvincular
            </Button>
            <a
              className="management-link"
              href={instance.endpoint}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={16} />
              Abrir Zerobyte / restaurar
            </a>
          </>
        )}
      </div>
      {!hosts.length && (
        <Empty
          title="Añade primero un host Docker"
          text="La conexión de Zerobyte se asocia al host que contiene los datos de los contenedores."
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Consultando Zerobyte…</p>}
      {instance && (
        <>
          <p className="muted">
            Host asociado:{' '}
            <strong>{hosts.find((h) => h.id === instance.docker_host_id)?.name}</strong>. Los
            volúmenes o directorios deben estar montados en Zerobyte. Para bases de datos, configura
            volcados consistentes antes de la copia.
          </p>
          <section className="panel">
            <div className="section-head">
              <h2>Trabajos de backup</h2>
              <Button
                disabled={!resources.volumes.length || !resources.repositories.length}
                onClick={() => {
                  setEditing(null);
                  setDialog('job');
                }}
              >
                <Plus size={16} />
                Crear trabajo
              </Button>
            </div>
            {!jobs.length ? (
              <Empty
                title="Sin trabajos"
                text="Configura los orígenes y repositorios en Zerobyte y pulsa Actualizar. Después podrás crear un trabajo aquí."
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Trabajo / origen</th>
                      <th>Programación</th>
                      <th>Última copia</th>
                      <th>Próxima copia</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.shortId}>
                        <td>
                          <strong>{j.name}</strong>
                          <small className="management-secondary">
                            {j.volume?.name} → {j.repository?.name}
                          </small>
                        </td>
                        <td>
                          {j.cronExpression}
                          <small className="management-secondary">
                            {j.enabled ? 'Activa' : 'Desactivada'}
                          </small>
                        </td>
                        <td>
                          <Badge value={j.lastBackupStatus ?? 'pending'} />
                          <small className="management-secondary">{date(j.lastBackupAt)}</small>
                        </td>
                        <td>{date(j.nextBackupAt)}</td>
                        <td>
                          <div className="row-actions">
                            <Button
                              variant="ghost"
                              title="Ejecutar backup"
                              onClick={() =>
                                setConfirm({
                                  title: `Ejecutar ${j.name}`,
                                  description:
                                    'Zerobyte iniciará una copia de los datos configurados. El historial indicará cuándo termina.',
                                  action: async () => {
                                    const r = await post<{ taskId: string }>(
                                      `${base}/jobs/${j.shortId}/run`,
                                    );
                                    notify(`Copia iniciada. Tarea ${r.taskId}`);
                                  },
                                })
                              }
                            >
                              <Play size={16} />
                            </Button>
                            <Button
                              variant="ghost"
                              title="Editar trabajo"
                              onClick={() => {
                                setEditing(j);
                                setDialog('job');
                              }}
                            >
                              <Pencil size={16} />
                            </Button>
                            <Button
                              variant="ghost"
                              title="Eliminar programación"
                              onClick={() =>
                                setConfirm({
                                  title: `Eliminar ${j.name}`,
                                  description:
                                    'Se elimina la programación en Zerobyte. Las copias existentes permanecen en el repositorio.',
                                  action: () =>
                                    api(`${base}/jobs/${j.shortId}`, { method: 'DELETE' }),
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="panel">
            <div className="section-head">
              <h2>Snapshots del repositorio</h2>
              <Database size={18} />
            </div>
            <div className="management-toolbar">
              <select
                aria-label="Repositorio de snapshots"
                value={repository}
                onChange={(e) => {
                  setRepository(e.target.value);
                  setSnapshots([]);
                }}
              >
                <option value="">Selecciona un repositorio</option>
                {resources.repositories.map((r) => (
                  <option key={r.shortId} value={r.shortId}>
                    {r.name}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                disabled={!repository}
                onClick={() => {
                  void api<Snapshot[]>(`${base}/repositories/${repository}/snapshots`)
                    .then(setSnapshots)
                    .catch((e) => notify(e.message));
                }}
              >
                Consultar snapshots
              </Button>
            </div>
            {snapshots.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Snapshot</th>
                      <th>Fecha</th>
                      <th>Tamaño</th>
                      <th>Rutas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s) => (
                      <tr key={s.short_id}>
                        <td>{s.short_id}</td>
                        <td>{date(s.time)}</td>
                        <td>{(s.size / 1024 / 1024).toFixed(1)} MB</td>
                        <td>{s.paths.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted management-note">
              La restauración se realiza desde Zerobyte, donde puedes elegir el snapshot y las rutas
              de destino.
            </p>
          </section>
          <section className="panel">
            <div className="section-head">
              <h2>Historial de tareas de Zerobyte</h2>
              <RefreshCw size={18} />
            </div>
            {history.items.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tarea</th>
                      <th>Tipo</th>
                      <th>Estado</th>
                      <th>Inicio</th>
                      <th>Fin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.items.map((h) => (
                      <tr key={h.id}>
                        <td>{h.id.slice(0, 12)}</td>
                        <td>{h.kind}</td>
                        <td>
                          <Badge value={h.outcome ?? h.status} />
                        </td>
                        <td>{date(h.startedAt)}</td>
                        <td>{date(h.finishedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title="Sin ejecuciones"
                text="Pulsa Actualizar después de ejecutar una copia para consultar el resultado."
              />
            )}
          </section>
        </>
      )}
      <Dialog
        open={['connection', 'edit-connection'].includes(dialog)}
        onOpenChange={() => setDialog('')}
        title="Conexión con Zerobyte"
        description="Compatible con Zerobyte v0.42.0. Genera la API key en su configuración. Al editar, deja la clave vacía para conservarla si no cambia la URL."
      >
        <Fields
          key={dialog}
          fields={connectionFields}
          initial={
            dialog === 'edit-connection'
              ? {
                  name: instance?.name,
                  endpoint: instance?.endpoint,
                  dockerHostId: instance?.docker_host_id,
                }
              : {}
          }
          submit={async (v) => {
            const { name, endpoint, dockerHostId, ...credentials } = v;
            await api(
              '/zerobyte/instances' + (dialog === 'edit-connection' ? '/' + selected : ''),
              {
                method: dialog === 'edit-connection' ? 'PUT' : 'POST',
                body: JSON.stringify({
                  name,
                  endpoint,
                  dockerHostId,
                  credentials: Object.fromEntries(
                    Object.entries(credentials).filter(([, value]) => value !== ''),
                  ),
                }),
              },
            );
            setDialog('');
            refresh();
          }}
        />
      </Dialog>
      <Dialog
        open={dialog === 'job'}
        onOpenChange={() => setDialog('')}
        title={editing ? 'Editar trabajo' : 'Crear trabajo de backup'}
        description="Comprueba que el origen corresponde a los datos Docker que quieres proteger. La programación se ejecuta en Zerobyte."
      >
        <Fields
          key={editing?.shortId ?? 'new'}
          fields={jobFields}
          initial={
            editing
              ? {
                  name: editing.name,
                  volumeId: resources.volumes.find((v) => v.id === editing.volumeId)?.shortId,
                  repositoryId: editing.repositoryId,
                  cronExpression: editing.cronExpression,
                  keepLast: editing.retentionPolicy?.keepLast ?? 7,
                  includePaths: editing.includePaths?.join('\n') ?? '',
                  excludePatterns: editing.excludePatterns?.join('\n') ?? '',
                  enabled: editing.enabled,
                }
              : {}
          }
          submit={async (v) => {
            const lines = (key: string) =>
              String(v[key] ?? '')
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
            const { name, volumeId, repositoryId, enabled, cronExpression } = v;
            await api(base + '/jobs' + (editing ? '/' + editing.shortId : ''), {
              method: editing ? 'PUT' : 'POST',
              body: JSON.stringify({
                name,
                volumeId,
                repositoryId,
                enabled,
                cronExpression,
                retentionPolicy: { keepLast: v.keepLast },
                includePaths: lines('includePaths'),
                excludePatterns: lines('excludePatterns'),
              }),
            });
            setDialog('');
            refresh();
          }}
        />
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={() => setConfirm(null)}
        title={confirm?.title ?? ''}
        description={confirm?.description}
      >
        <Button
          disabled={busy}
          onClick={() => {
            if (!confirm) return;
            setBusy(true);
            void confirm
              .action()
              .then(() => {
                setConfirm(null);
                refresh();
              })
              .catch((e) => notify(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Procesando…' : 'Confirmar'}
        </Button>
      </Dialog>
    </div>
  );
}
