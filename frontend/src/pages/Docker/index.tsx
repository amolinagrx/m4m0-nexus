import { useEffect, useState } from 'react';
import {
  Plus,
  RefreshCw,
  Play,
  Square,
  RotateCw,
  Pause,
  Trash2,
  FileText,
  Pencil,
  Database,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, post } from '../../services/api';
import { Badge, Empty, Fields, type Field } from '../../components/ResourceUI';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
export interface DockerHost {
  id: string;
  name: string;
  endpoint: string;
  status: string;
}
interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  project: string;
  service: string;
  mounts: { Type: string; Name?: string; Source?: string; Destination: string }[];
  ports: { PrivatePort: number; PublicPort?: number; IP?: string; Type: string }[];
}
interface Inventory {
  containers: Container[];
  images: { Id: string; RepoTags?: string[]; Size: number }[];
  volumes: { Name: string; Driver: string }[];
  networks: { Id: string; Name: string; Driver: string }[];
}
const hostFields: Field[] = [
  { key: 'name', label: 'Nombre', required: true },
  {
    key: 'endpoint',
    label: 'Endpoint HTTPS',
    type: 'url',
    hint: 'https://docker.example.com:2376',
    required: true,
  },
  { key: 'caCert', label: 'Certificado CA (PEM)', type: 'textarea' },
  { key: 'clientCert', label: 'Certificado de cliente (PEM)', type: 'textarea' },
  { key: 'clientKey', label: 'Clave privada de cliente (PEM)', type: 'textarea' },
];
export default function DockerView({
  demo,
  revision: externalRevision,
  canManage,
  notify,
}: {
  demo: boolean;
  revision: number;
  canManage: boolean;
  notify: (m: string) => void;
}) {
  const [hosts, setHosts] = useState<DockerHost[]>([]),
    [selected, setSelected] = useState(''),
    [inventory, setInventory] = useState<Inventory | null>(null);
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [dialog, setDialog] = useState('');
  const [logs, setLogs] = useState(''),
    [confirm, setConfirm] = useState<{ container: Container; action: string } | null>(null),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('containers'),
    [project, setProject] = useState('');
  const host = hosts.find((h) => h.id === selected);
  const refresh = () => setRevision((r) => r + 1);
  useEffect(() => {
    if (demo) return;
    let active = true;
    void api<DockerHost[]>('/docker/hosts')
      .then((h) => {
        if (active) {
          setHosts(h);
          setSelected((s) => (h.some((x) => x.id === s) ? s : (h[0]?.id ?? '')));
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
    setInventory(null);
    setError('');
    setProject('');
    if (demo || !selected) return;
    let active = true;
    setLoading(true);
    void api<Inventory>(`/docker/hosts/${selected}/inventory`)
      .then((data) => {
        if (active) setInventory(data);
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
  if (demo)
    return (
      <Empty
        title="Gestiona tus hosts Docker"
        text="Conecta tu entorno para registrar un host Docker y consultar sus contenedores, imágenes, volúmenes y redes."
      />
    );
  return (
    <div className="container-management">
      <div className="panel management-toolbar">
        <label>
          Host Docker
          <select
            aria-label="Host Docker"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Selecciona un host</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" disabled={loading} onClick={refresh}>
          <RefreshCw size={16} />
          Actualizar
        </Button>
        {canManage && (
          <>
            <Button onClick={() => setDialog('host')}>
              <Plus size={16} />
              Añadir host
            </Button>
            {host && (
              <>
                <Button variant="ghost" onClick={() => setDialog('edit')}>
                  <Pencil size={16} />
                  Editar conexión
                </Button>
                <Button variant="ghost" onClick={() => setDialog('disconnect')}>
                  Desvincular
                </Button>
              </>
            )}
          </>
        )}
        {canManage && (
          <Link to="/zerobyte" className="management-link">
            <Database size={16} />
            Backups con Zerobyte
          </Link>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Consultando Docker…</p>}
      {!hosts.length && !loading && (
        <Empty
          title="Sin hosts Docker"
          text="Añade un endpoint Docker con sus certificados de cliente."
        />
      )}
      {inventory && (
        <>
          <div className="management-stats">
            {[
              ['Contenedores', inventory.containers.length],
              ['En ejecución', inventory.containers.filter((c) => c.state === 'running').length],
              ['Volúmenes', inventory.volumes.length],
              ['Imágenes', inventory.images.length],
            ].map(([label, value]) => (
              <div className="panel" key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <section className="panel">
            <div className="section-head management-toolbar">
              <div className="management-tabs">
                {[
                  ['containers', 'Contenedores'],
                  ['images', 'Imágenes'],
                  ['volumes', 'Volúmenes'],
                  ['networks', 'Redes'],
                ].map(([key, label]) => (
                  <Button
                    variant={tab === key ? 'default' : 'ghost'}
                    key={key}
                    onClick={() => setTab(key!)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {canManage && (
                <Button
                  variant="outline"
                  onClick={() => setDialog(tab === 'volumes' ? 'volume' : 'container')}
                >
                  <Plus size={16} />
                  {tab === 'volumes' ? 'Crear volumen' : 'Crear contenedor'}
                </Button>
              )}
            </div>
            {tab === 'containers' ? (
              <>
                <label className="management-filter">
                  Proyecto Compose
                  <select value={project} onChange={(e) => setProject(e.target.value)}>
                    <option value="">Todos los proyectos</option>
                    {Array.from(
                      new Set(inventory.containers.map((c) => c.project).filter(Boolean)),
                    ).map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Contenedor / imagen</th>
                        <th>Estado</th>
                        <th>Compose</th>
                        <th>Puertos y datos</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventory.containers
                        .filter((c) => !project || c.project === project)
                        .map((c) => (
                          <tr key={c.id}>
                            <td>
                              <strong>{c.name}</strong>
                              <small className="management-secondary">{c.image}</small>
                            </td>
                            <td>
                              <Badge value={c.state} />
                              <small className="management-secondary">{c.status}</small>
                            </td>
                            <td>
                              {c.project || '—'}
                              <small className="management-secondary">{c.service}</small>
                            </td>
                            <td>
                              {c.ports
                                .filter((p) => p.PublicPort)
                                .map((p) => (
                                  <small
                                    className="management-secondary"
                                    key={`${p.PublicPort}-${p.PrivatePort}`}
                                  >
                                    {p.IP}:{p.PublicPort} → {p.PrivatePort}/{p.Type}
                                  </small>
                                ))}
                              {c.mounts.map((m) => (
                                <small className="management-secondary" key={m.Destination}>
                                  {m.Name || m.Source || m.Type} → {m.Destination}
                                </small>
                              ))}
                            </td>
                            <td>
                              {canManage && (
                                <div className="row-actions">
                                  {(c.state === 'paused'
                                    ? [['unpause', Play, 'Reanudar']]
                                    : c.state === 'running'
                                      ? [
                                          ['stop', Square, 'Detener'],
                                          ['restart', RotateCw, 'Reiniciar'],
                                          ['pause', Pause, 'Pausar'],
                                        ]
                                      : [
                                          ['start', Play, 'Arrancar'],
                                          ['remove', Trash2, 'Eliminar'],
                                        ]
                                  ).map(([action, Icon, label]) => {
                                    const I = Icon as typeof Play;
                                    return (
                                      <Button
                                        key={String(action)}
                                        variant="ghost"
                                        title={String(label)}
                                        aria-label={`${label} ${c.name}`}
                                        onClick={() =>
                                          setConfirm({ container: c, action: String(action) })
                                        }
                                      >
                                        <I size={16} />
                                      </Button>
                                    );
                                  })}
                                  <Button
                                    variant="ghost"
                                    title="Ver logs"
                                    onClick={() => {
                                      setLogs('Cargando…');
                                      setDialog('logs');
                                      void api<{ text: string }>(
                                        `/docker/hosts/${selected}/containers/${c.id}/logs`,
                                      )
                                        .then((r) => setLogs(r.text || 'Sin logs'))
                                        .catch((e) => setLogs(e.message));
                                    }}
                                  >
                                    <FileText size={16} />
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>{tab === 'images' ? 'Tamaño' : 'Driver'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tab === 'images'
                      ? inventory.images.map((i) => (
                          <tr key={i.Id}>
                            <td>{i.RepoTags?.join(', ') || i.Id}</td>
                            <td>{(i.Size / 1024 / 1024).toFixed(1)} MB</td>
                          </tr>
                        ))
                      : (tab === 'volumes' ? inventory.volumes : inventory.networks).map((r) => (
                          <tr key={r.Name}>
                            <td>{r.Name}</td>
                            <td>{r.Driver}</td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      <Dialog
        open={['host', 'edit'].includes(dialog)}
        onOpenChange={() => setDialog('')}
        title={dialog === 'edit' ? 'Editar host Docker' : 'Añadir host Docker'}
        description="Docker Engine 27+ con TLS mutuo. Al editar, deja vacíos los certificados para conservarlos si no cambia el endpoint."
      >
        <Fields
          key={dialog}
          fields={hostFields}
          initial={dialog === 'edit' ? { name: host?.name, endpoint: host?.endpoint } : {}}
          submit={async (v) => {
            const { name, endpoint, ...credentials } = v;
            await api(`/docker/hosts${dialog === 'edit' ? '/' + selected : ''}`, {
              method: dialog === 'edit' ? 'PUT' : 'POST',
              body: JSON.stringify({
                name,
                endpoint,
                credentials: Object.fromEntries(
                  Object.entries(credentials).filter(([, value]) => value !== ''),
                ),
              }),
            });
            setDialog('');
            refresh();
          }}
        />
      </Dialog>
      <Dialog
        open={dialog === 'container'}
        onOpenChange={() => setDialog('')}
        title="Crear contenedor"
        description="Usa una imagen ya disponible en el host. Se creará detenido; podrás arrancarlo después."
      >
        <Fields
          fields={[
            { key: 'name', label: 'Nombre', required: true },
            {
              key: 'image',
              label: 'Imagen local',
              required: true,
              options: inventory?.images.flatMap((i) => (i.RepoTags?.length ? i.RepoTags : [i.Id])),
            },
            { key: 'containerPort', label: 'Puerto TCP del contenedor (opcional)', type: 'number' },
            { key: 'hostPort', label: 'Puerto TCP del host (opcional)', type: 'number' },
            { key: 'hostIp', label: 'Publicar en', options: ['127.0.0.1', '0.0.0.0'] },
            {
              key: 'volume',
              label: 'Volumen existente (opcional)',
              options: ['', ...(inventory?.volumes.map((v) => v.Name) ?? [])],
            },
            { key: 'target', label: 'Ruta del volumen dentro del contenedor' },
          ]}
          submit={async (v) => {
            await post(`/docker/hosts/${selected}/containers`, {
              name: v.name,
              image: v.image,
              ports:
                v.containerPort || v.hostPort
                  ? [{ containerPort: v.containerPort, hostPort: v.hostPort, hostIp: v.hostIp }]
                  : [],
              volumes: v.volume ? [{ name: v.volume, target: v.target }] : [],
            });
            setDialog('');
            refresh();
          }}
        />
      </Dialog>
      <Dialog open={dialog === 'volume'} onOpenChange={() => setDialog('')} title="Crear volumen">
        <Fields
          fields={[{ key: 'name', label: 'Nombre del volumen', required: true }]}
          submit={async (v) => {
            await post(`/docker/hosts/${selected}/volumes`, v);
            setDialog('');
            refresh();
          }}
        />
      </Dialog>
      <Dialog
        open={dialog === 'logs'}
        onOpenChange={() => setDialog('')}
        title="Logs del contenedor"
      >
        <pre className="management-logs">{logs}</pre>
      </Dialog>
      <Dialog
        open={dialog === 'disconnect'}
        onOpenChange={() => setDialog('')}
        title="Desvincular host"
        description={`Se retirará ${host?.name} de NEXUS. Los contenedores seguirán en Docker.`}
      >
        <Button
          onClick={() => {
            void api(`/docker/hosts/${selected}`, { method: 'DELETE' })
              .then(() => {
                setDialog('');
                setSelected('');
                refresh();
              })
              .catch((e) => notify(e.message));
          }}
        >
          Desvincular
        </Button>
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={() => setConfirm(null)}
        title={`${({ start: 'Arrancar', stop: 'Detener', restart: 'Reiniciar', pause: 'Pausar', unpause: 'Reanudar', remove: 'Eliminar' } as Record<string, string>)[confirm?.action ?? '']} ${confirm?.container.name ?? ''}`}
        description={
          confirm?.action === 'remove'
            ? 'Se elimina el contenedor detenido. Sus volúmenes se conservan.'
            : 'La operación se ejecutará en el host Docker seleccionado.'
        }
      >
        <Button
          disabled={busy}
          onClick={() => {
            if (!confirm) return;
            setBusy(true);
            void post(`/docker/hosts/${selected}/containers/${confirm.container.id}/action`, {
              action: confirm.action,
            })
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
