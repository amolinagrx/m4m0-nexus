import {
  useEffect,
  useState,
  useMemo,
  lazy,
  Suspense,
  type FormEvent,
  type ReactNode,
} from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  Box,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileClock,
  Globe,
  HardDrive,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Network,
  Pause,
  Play,
  Plus,
  Power,
  Pencil,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  Terminal,
  Trash2,
  Users,
  Webhook,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { io } from 'socket.io-client';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { api, post, setAccessToken, getAccessToken, download, type Identity } from './services/api';
import { demoData, demoInfrastructure, demoVMs, type Row } from './services/demo';
import BackupHistory from './pages/Backup';
import ExportImport from './pages/ExportImport';
import KubernetesView from './pages/Kubernetes';
import { Empty, Badge, Provider, Cell, Fields, type Field } from './components/ResourceUI';
import { VMConsole } from './components/VMConsole';
const groups = [
  {
    label: 'WORKSPACE',
    items: [
      ['/', 'Vista general', LayoutDashboard],
      ['/infrastructure', 'Infraestructuras', Layers3],
      ['/vms', 'Máquinas virtuales', Monitor],
      ['/hosts', 'Hosts', Server],
      ['/storage', 'Almacenamiento', HardDrive],
      ['/kubernetes', 'Kubernetes', Boxes],
    ],
  },
  {
    label: 'OPERACIONES',
    items: [
      ['/backup', 'Backups', Database],
      ['/webhooks', 'Webhooks', Webhook],
      ['/tokens', 'API tokens', KeyRound],
      ['/plugins', 'Plugins', Box],
    ],
  },
  {
    label: 'ADMINISTRACIÓN',
    items: [
      ['/users', 'Usuarios', Users],
      ['/ldap', 'LDAP / Active Directory', Shield],
      ['/export-import', 'Exportar / importar', ArrowDownToLine],
      ['/maintenance', 'Mantenimiento', Wrench],
      ['/audit', 'Auditoría', FileClock],
      ['/settings', 'Configuración', Settings],
    ],
  },
];
const titles: Record<string, string> = {
  '/': 'Vista general',
  '/infrastructure': 'Infraestructuras',
  '/vms': 'Máquinas virtuales',
  '/hosts': 'Hosts',
  '/storage': 'Almacenamiento',
  '/kubernetes': 'Kubernetes',
  '/backup': 'Backups',
  '/webhooks': 'Webhooks',
  '/tokens': 'API tokens',
  '/plugins': 'Plugins',
  '/users': 'Usuarios',
  '/ldap': 'LDAP / Active Directory',
  '/export-import': 'Exportar / importar',
  '/maintenance': 'Mantenimiento',
  '/audit': 'Auditoría',
  '/settings': 'Configuración',
};
const descriptions: Record<string, string> = {
  '/': 'Toda tu infraestructura. Un único punto de control.',
  '/infrastructure': 'Conecta y sincroniza tus entornos de virtualización.',
  '/vms': 'Supervisa y opera las máquinas de todos tus entornos.',
  '/backup': 'Protege la configuración y programa copias de tus máquinas.',
  '/kubernetes': 'Explora los recursos y las cargas de tus clusters.',
  '/webhooks': 'Conecta los eventos de tu infraestructura con tus herramientas.',
  '/tokens': 'Acceso programático con permisos granulares.',
  '/plugins': 'Extiende NEXUS con módulos revisados por tu equipo.',
};
const infraFields: Field[] = [
  { key: 'name', label: 'Nombre', required: true },
  {
    key: 'type',
    label: 'Proveedor',
    options: ['proxmox', 'kubernetes', 'xcpng', 'citrix', 'vmware'],
    initial: 'proxmox',
  },
  {
    key: 'endpoint',
    label: 'Endpoint HTTPS',
    type: 'url',
    required: true,
    hint: 'Ejemplo: https://pve.example.com:8006',
  },
  { key: 'username', label: 'Usuario' },
  { key: 'password', label: 'Contraseña', type: 'password' },
  { key: 'tokenId', label: 'ID de token Proxmox' },
  { key: 'token', label: 'API token / bearer token', type: 'password' },
  { key: 'caCert', label: 'Certificado CA (PEM)', type: 'textarea' },
  { key: 'kubeconfig', label: 'Kubeconfig con credenciales inline (opcional)', type: 'textarea' },
];
const fieldSets: Record<string, Field[]> = {
  '/infrastructure': infraFields,
  '/webhooks': [
    { key: 'name', label: 'Nombre', required: true },
    { key: 'url', label: 'URL de destino', type: 'url', required: true },
    { key: 'method', label: 'Método', options: ['POST', 'GET', 'PUT'] },
    {
      key: 'events',
      label: 'Eventos (separados por comas)',
      initial: 'vm.started, vm.stopped, backup.failed',
      required: true,
    },
    { key: 'secret', label: 'Secreto HMAC (mínimo 16 caracteres)', type: 'password' },
    { key: 'headers', label: 'Cabeceras adicionales (JSON)', type: 'textarea', initial: '{}' },
    { key: 'active', label: 'Activo', type: 'checkbox', initial: true },
  ],
  '/tokens': [
    { key: 'name', label: 'Nombre', required: true },
    {
      key: 'scopes',
      label: 'Scopes (separados por comas)',
      initial: 'infra:read, vms:read',
      required: true,
    },
    { key: 'expiresAt', label: 'Fecha de caducidad (opcional)', type: 'datetime-local' },
  ],
  '/users': [
    { key: 'email', label: 'Correo electrónico', type: 'email', required: true },
    {
      key: 'password',
      label: 'Contraseña (mínimo 16 caracteres)',
      type: 'password',
      required: true,
    },
    { key: 'role', label: 'Rol', options: ['readonly', 'user', 'admin'] },
  ],
  '/plugins': [
    {
      key: 'id',
      label: 'ID del plugin instalado en el servidor',
      required: true,
      hint: 'Ejemplo: example-plugin. Solo módulos revisados e instalados por un administrador.',
    },
  ],
  '/backup': [
    { key: 'name', label: 'Nombre', required: true },
    { key: 'type', label: 'Tipo', options: ['full', 'infrastructure', 'vm'] },
    { key: 'schedule', label: 'Programación cron (UTC)', initial: '0 2 * * *', required: true },
    { key: 'retention', label: 'Retención en días', type: 'number', initial: 30 },
    { key: 'targets', label: 'IDs de VM (separados por comas, para tipo vm)' },
    { key: 'storageType', label: 'Almacenamiento', options: ['local', 's3', 'nfs', 'smb'] },
    { key: 'bucket', label: 'Bucket S3' },
    { key: 'endpoint', label: 'Endpoint S3', type: 'url' },
    { key: 'accessKey', label: 'Access key S3', type: 'password' },
    { key: 'secretKey', label: 'Secret key S3', type: 'password' },
    { key: 'proxmoxStorage', label: 'ID de almacenamiento Proxmox (copias VM)' },
    { key: 'encryption', label: 'Cifrar copia de configuración', type: 'checkbox', initial: true },
    {
      key: 'encryptionPassword',
      label: 'Contraseña de cifrado (mínimo 16 caracteres)',
      type: 'password',
    },
    { key: 'compression', label: 'Compresión', type: 'checkbox', initial: true },
  ],
};
function transform(path: string, v: Row) {
  const list = (k: string) =>
    String(v[k] ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  if (path === '/infrastructure') {
    const { name, type, endpoint, ...creds } = v;
    return {
      name,
      type,
      endpoint,
      credentials: Object.fromEntries(Object.entries(creds).filter(([, v]) => v !== '')),
    };
  }
  if (path === '/webhooks')
    return {
      ...v,
      events: list('events'),
      headers: JSON.parse(String(v.headers)),
      secret: v.secret || undefined,
    };
  if (path === '/tokens')
    return {
      ...v,
      scopes: list('scopes'),
      expiresAt: v.expiresAt ? new Date(String(v.expiresAt)).toISOString() : undefined,
    };
  if (path === '/backup') {
    const { name, type, schedule, retention, encryption, encryptionPassword, compression } = v;
    return {
      name,
      type,
      schedule,
      retention,
      encryption,
      encryptionPassword: encryptionPassword || undefined,
      compression,
      targets: list('targets'),
      storage: Object.fromEntries(
        Object.entries({
          type: v.storageType,
          bucket: v.bucket,
          endpoint: v.endpoint,
          accessKey: v.accessKey,
          secretKey: v.secretKey,
          proxmoxStorage: v.proxmoxStorage,
        }).filter(([, v]) => v !== ''),
      ),
    };
  }
  return v;
}
export default function App() {
  const location = useLocation(),
    navigate = useNavigate();
  const path = location.pathname;
  const [demo, setDemo] = useState(true),
    [identity, setIdentity] = useState<Identity | null>(null),
    [login, setLogin] = useState(false),
    [mobile, setMobile] = useState(false),
    [search, setSearch] = useState(''),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState(''),
    [maintenance, setMaintenance] = useState(false),
    [newResource, setNewResource] = useState(false),
    [editing, setEditing] = useState<Row | null>(null),
    [pluginConfig, setPluginConfig] = useState<Row | null>(null),
    [oneTime, setOneTime] = useState(''),
    [detail, setDetail] = useState<ReactNode | null>(null),
    [confirm, setConfirm] = useState<{ title: string; action: () => Promise<void> } | null>(null);
  const [infra, setInfra] = useState<Row[]>(demoInfrastructure),
    [vms, setVMs] = useState<Row[]>(demoVMs),
    [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [selectedInfra, setSelectedInfra] = useState(''),
    [live, setLive] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const canManage = !identity || identity.role === 'admin';
  const canWrite = !identity || identity.role !== 'readonly';
  const adminPages = [
    '/backup',
    '/plugins',
    '/users',
    '/ldap',
    '/export-import',
    '/maintenance',
    '/audit',
    '/settings',
  ];
  const editable =
    canWrite && (!['/infrastructure', '/webhooks', ...adminPages].includes(path) || canManage);
  const refresh = () => setRevision((x) => x + 1);
  const notify = (m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(''), 6000);
  };
  const guard = () => {
    if (demo)
      throw new Error(
        'Estás en el entorno de demostración. Conéctate a tu servidor para ejecutar esta operación.',
      );
  };
  useEffect(() => {
    const fn = () => {
      setIdentity(null);
      setLogin(true);
    };
    window.addEventListener('nexus:unauthorized', fn);
    return () => window.removeEventListener('nexus:unauthorized', fn);
  }, []);
  useEffect(() => {
    setSearch('');
    setMobile(false);
    setError('');
  }, [path]);
  useEffect(() => {
    if (demo) return;
    const socket = io({ auth: { token: getAccessToken() } });
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.on('metrics', () => {
      setRevision((x) => x + 1);
    });
    return () => {
      socket.disconnect();
    };
  }, [demo, identity]);
  useEffect(() => {
    if (demo) {
      setInfra(demoInfrastructure);
      setVMs(demoVMs);
      return;
    }
    let cancelled = false;
    void Promise.all([
      api<Row[]>('/infrastructure'),
      api<Row[]>('/vms'),
      api<{ active: boolean }>('/maintenance/status'),
    ])
      .then(([i, v, m]) => {
        if (!cancelled) {
          setInfra(i);
          setVMs(v);
          setMaintenance(m.active);
          setHistory((h) => [...h.slice(-19), v.filter((x) => x.state === 'running').length]);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [demo, revision]);
  const endpoints: Record<string, string> = {
    '/backup': '/backups/jobs',
    '/kubernetes': '/kubernetes/clusters',
  };
  const endpoint = endpoints[path] ?? path;
  useEffect(() => {
    if (['/', '/ldap', '/export-import', '/maintenance', '/settings', '/kubernetes'].includes(path))
      return;
    setError('');
    if (path === '/infrastructure') {
      setRows(infra);
      return;
    }
    if (path === '/vms') {
      setRows(vms);
      return;
    }
    if (demo) {
      if (path === '/hosts')
        setRows([
          { id: 'node-01', name: 'pve-node-01', state: 'online', cpus: 32, memoryMB: 131072 },
          { id: 'node-02', name: 'pve-node-02', state: 'online', cpus: 32, memoryMB: 131072 },
        ]);
      else if (path === '/storage')
        setRows([
          {
            id: 'ceph-01',
            name: 'ceph-production',
            type: 'ceph',
            capacityBytes: 10995116277760,
            usedBytes: 4380866641920,
          },
        ]);
      else setRows(demoData[endpoint] ?? []);
      return;
    }
    if (['/hosts', '/storage'].includes(path) && !selectedInfra) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void api<Row[]>(
      endpoint +
        (['/hosts', '/storage'].includes(path) ? '?infrastructureId=' + selectedInfra : ''),
    )
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, endpoint, demo, revision, infra, vms, selectedInfra]);
  const filtered = rows.filter((r) =>
    JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
  );
  const columns: Record<string, [string, string][]> = {
    '/infrastructure': [
      ['name', 'Infraestructura'],
      ['type', 'Proveedor'],
      ['endpoint', 'Endpoint'],
      ['status', 'Estado'],
      ['last_sync', 'Última sincronización'],
    ],
    '/vms': [
      ['name', 'Máquina virtual'],
      ['state', 'Estado'],
      ['infrastructure_type', 'Proveedor'],
      ['host', 'Host'],
      ['cpus', 'vCPU'],
      ['memory_mb', 'Memoria'],
    ],
    '/hosts': [
      ['name', 'Host'],
      ['state', 'Estado'],
      ['cpus', 'vCPU'],
      ['memoryMB', 'Memoria (MB)'],
    ],
    '/storage': [
      ['name', 'Almacenamiento'],
      ['type', 'Tipo'],
      ['capacityBytes', 'Capacidad (bytes)'],
      ['usedBytes', 'En uso (bytes)'],
    ],
    '/backup': [
      ['name', 'Job'],
      ['type', 'Tipo'],
      ['schedule', 'Cron · UTC'],
      ['storage_type', 'Destino'],
      ['retention_days', 'Retención (días)'],
      ['active', 'Estado'],
    ],
    '/webhooks': [
      ['name', 'Webhook'],
      ['url', 'Destino'],
      ['events', 'Eventos'],
      ['active', 'Estado'],
    ],
    '/tokens': [
      ['name', 'Token'],
      ['scopes', 'Scopes'],
      ['last_used_at', 'Último uso'],
      ['expires_at', 'Caducidad'],
    ],
    '/plugins': [
      ['name', 'Plugin'],
      ['description', 'Descripción'],
      ['version', 'Versión'],
      ['active', 'Estado'],
    ],
    '/users': [
      ['email', 'Usuario'],
      ['role', 'Rol'],
      ['source', 'Autenticación'],
      ['active', 'Estado'],
    ],
    '/audit': [
      ['action', 'Acción'],
      ['resource', 'Recurso'],
      ['created_at', 'Fecha'],
    ],
  };
  async function action(url: string, label: string, body: Row = {}) {
    guard();
    await post(url, body);
    notify(label);
    refresh();
  }
  function actions(row: Row) {
    if (!editable) return null;
    const id = String(row.id);
    if (path === '/infrastructure')
      return (
        <Button
          variant="ghost"
          title="Sincronizar"
          onClick={() =>
            void action(`/infrastructure/${id}/sync`, 'Inventario sincronizado').catch((e) =>
              notify(e.message),
            )
          }
        >
          <RefreshCw size={16} />
        </Button>
      );
    if (path === '/vms')
      return (
        <>
          <Button
            variant="ghost"
            title="Abrir consola"
            onClick={() => {
              if (demo) {
                notify('La consola requiere una VM real conectada.');
                return;
              }
              setDetail(<VMConsole vmId={id} />);
            }}
          >
            <Terminal size={16} />
          </Button>
          <Button
            variant="ghost"
            title={row.state === 'running' ? 'Apagar' : 'Iniciar'}
            onClick={() =>
              setConfirm({
                title: `${row.state === 'running' ? 'Apagar' : 'Iniciar'} ${row.name}`,
                action: () =>
                  action(
                    `/vms/${id}/${row.state === 'running' ? 'stop' : 'start'}`,
                    'Operación completada',
                  ),
              })
            }
          >
            {row.state === 'running' ? <Power size={16} /> : <Play size={16} />}
          </Button>
        </>
      );
    if (path === '/backup')
      return (
        <Button
          variant="ghost"
          title="Ejecutar backup"
          onClick={() =>
            void action(`/backups/jobs/${id}/run`, 'Backup añadido a la cola').catch((e) =>
              notify(e.message),
            )
          }
        >
          <Play size={16} />
        </Button>
      );
    if (path === '/webhooks')
      return (
        <>
          <Button
            variant="ghost"
            title="Test"
            onClick={() =>
              void action(`/webhooks/${id}/test`, 'Test añadido a la cola').catch((e) =>
                notify(e.message),
              )
            }
          >
            <Zap size={16} />
          </Button>
          <Button
            variant="ghost"
            title="Logs de entrega"
            onClick={() => {
              if (demo) {
                setDetail(
                  <Empty
                    title="Sin entregas reales"
                    text="Los webhooks de esta vista son ejemplos."
                  />,
                );
                return;
              }
              void api<Row[]>(`/webhooks/${id}/logs`)
                .then((r) => setDetail(<pre>{JSON.stringify(r, null, 2)}</pre>))
                .catch((e) => notify(e.message));
            }}
          >
            <FileClock size={16} />
          </Button>
        </>
      );
    if (path === '/plugins')
      return (
        <Button
          variant="outline"
          onClick={() =>
            void action(
              `/plugins/${id}/${row.active ? 'disable' : 'enable'}`,
              row.active ? 'Plugin desactivado' : 'Plugin activado',
            ).catch((e) => notify(e.message))
          }
        >
          {row.active ? 'Desactivar' : 'Activar'}
        </Button>
      );
    return null;
  }
  function remove(row: Row) {
    setConfirm({
      title: `Eliminar ${row.name ?? row.email ?? 'recurso'}`,
      action: async () => {
        guard();
        await api(`${endpoint}/${row.id}`, { method: 'DELETE' });
        notify('Recurso eliminado');
        refresh();
      },
    });
  }
  const running = vms.filter((v) => ['running', 'powered_on'].includes(String(v.state))).length,
    connected = infra.filter((i) => i.status === 'connected').length;
  function resourceTable(data: Row[], cols: [string, string][], withActions = false) {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {cols.map(([key, title]) => (
                <th key={key}>{title}</th>
              ))}
              {withActions && <th className="text-right">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={String(r.id ?? i)}>
                {cols.map(([key]) => (
                  <td key={key}>
                    {key === 'name' && (
                      <span className="row-icon">
                        {path === '/vms' ? <Monitor size={16} /> : <Server size={16} />}
                      </span>
                    )}
                    <Cell name={key} value={r[key]} />
                  </td>
                ))}
                {withActions && (
                  <td>
                    <div className="table-actions">
                      {actions(r)}
                      {editable &&
                        ['/infrastructure', '/webhooks', '/backup', '/users'].includes(path) && (
                          <Button variant="ghost" title="Editar" onClick={() => setEditing(r)}>
                            <Pencil size={15} />
                          </Button>
                        )}
                      {editable && path === '/plugins' && (
                        <Button
                          variant="ghost"
                          title="Configurar"
                          onClick={() => setPluginConfig(r)}
                        >
                          <Settings size={15} />
                        </Button>
                      )}
                      {editable && path === '/tokens' && (
                        <Button
                          variant="ghost"
                          title="Rotar token"
                          onClick={() =>
                            setConfirm({
                              title: 'Rotar ' + String(r.name),
                              action: async () => {
                                guard();
                                const result = await post<{ token: string }>(
                                  `/tokens/${r.id}/rotate`,
                                );
                                setOneTime(result.token);
                                refresh();
                              },
                            })
                          }
                        >
                          <RefreshCw size={15} />
                        </Button>
                      )}
                      {editable &&
                        [
                          '/infrastructure',
                          '/webhooks',
                          '/tokens',
                          '/plugins',
                          '/users',
                          '/backup',
                        ].includes(path) && (
                          <Button variant="ghost" title="Eliminar" onClick={() => remove(r)}>
                            <Trash2 size={15} />
                          </Button>
                        )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <NavLink to="/" className="brand">
          <span className="brand-mark">
            <Network size={22} />
          </span>
          <span>
            <b>
              m4m0 <strong>NEXUS</strong>
            </b>
            <small>INFRASTRUCTURE CONTROL</small>
          </span>
        </NavLink>
        <div className="workspace-selector">
          <span className="workspace-avatar">m4</span>
          <span>
            m4m0 consulting<small>Workspace principal</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <nav>
          {groups.map((g) => (
            <div className="nav-group" key={g.label}>
              <p>{g.label}</p>
              {g.items
                .filter(([url]) => canManage || !adminPages.includes(String(url)))
                .map(([url, label, Icon]) => {
                  const I = Icon as typeof Activity;
                  return (
                    <NavLink
                      key={String(url)}
                      to={String(url)}
                      end={url === '/'}
                      className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                    >
                      <I size={18} />
                      <span>{String(label)}</span>
                      {url === '/infrastructure' && <small>{infra.length}</small>}
                    </NavLink>
                  );
                })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div>
            <span className="status-light" />
            NEXUS <span className="mono">v0.1.0</span>
          </div>
          <a href="https://m4m0.es" target="_blank" rel="noreferrer">
            by m4m0 consulting <ArrowUpRight size={13} />
          </a>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu"
              aria-label="Abrir menú"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{titles[path] ?? 'NEXUS'}</strong>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <i />
              {demo
                ? 'Entorno de demostración'
                : live
                  ? 'Conectado en tiempo real'
                  : 'Sesión activa'}
            </span>
            <button
              className="icon-button"
              title="Notificaciones"
              onClick={() =>
                setDetail(
                  <>
                    <h3>Estado de infraestructura</h3>
                    {infra.some((i) => i.status === 'error') ? (
                      infra
                        .filter((i) => i.status === 'error')
                        .map((i) => (
                          <p key={String(i.id)} className="error">
                            {String(i.name)} · No disponible{demo ? ' (ejemplo)' : ''}
                          </p>
                        ))
                    ) : (
                      <p>No hay incidencias de conexión registradas.</p>
                    )}
                  </>,
                )
              }
            >
              <Bell size={19} />
              {infra.some((i) => i.status === 'error') && <i />}
            </button>
            <span className="divider" />
            <button className="user-button" onClick={() => setLogin(true)}>
              <span className="avatar">
                {identity ? identity.email.slice(0, 2).toUpperCase() : 'AM'}
              </span>
              <span>
                {identity?.email ?? 'Administrador'}
                <small>{identity?.role ?? 'Vista de demostración'}</small>
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>
              <Globe size={14} /> Estás explorando datos de ejemplo. Ningún servidor está conectado.
            </span>
            <button onClick={() => setLogin(true)}>
              Conectar mi entorno <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        {maintenance && (
          <div className="maintenance-banner">
            <Wrench size={16} /> Modo mantenimiento activo. Las escrituras están restringidas.
          </div>
        )}
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">{path === '/' ? 'CONTROL CENTER' : 'WORKSPACE'}</div>
              <h1>{titles[path] ?? 'Página no encontrada'}</h1>
              <p>
                {descriptions[path] ??
                  'Administra los recursos y la configuración de tu plataforma.'}
              </p>
            </div>
            <div className="heading-actions">
              <Button variant="outline" onClick={refresh}>
                <RefreshCw size={16} /> Actualizar
              </Button>
              {editable && (fieldSets[path] || path === '/') && (
                <Button
                  onClick={() => {
                    if (path === '/') {
                      navigate('/infrastructure');
                    }
                    setNewResource(true);
                  }}
                >
                  <Plus size={17} />
                  {path === '/' || path === '/infrastructure'
                    ? 'Añadir infraestructura'
                    : path === '/backup'
                      ? 'Crear job'
                      : path === '/tokens'
                        ? 'Crear token'
                        : path === '/plugins'
                          ? 'Instalar plugin'
                          : 'Añadir'}
                </Button>
              )}
            </div>
          </div>
          {error && (
            <div role="alert" className="error error-box">
              {error}
              <Button variant="ghost" onClick={refresh}>
                Reintentar
              </Button>
            </div>
          )}
          {path === '/' ? (
            <>
              <div className="stat-grid">
                {[
                  [
                    Layers3,
                    'Infraestructuras',
                    infra.length,
                    `${connected} conectadas`,
                    infra.length - connected > 0
                      ? `${infra.length - connected} requiere atención`
                      : 'Todos los entornos conectados',
                  ],
                  [
                    Monitor,
                    'Máquinas virtuales',
                    vms.length,
                    `${running} en ejecución`,
                    `${vms.length - running} detenidas`,
                  ],
                  [
                    Cpu,
                    'vCPU asignadas',
                    vms.reduce((s, v) => s + Number(v.cpus ?? 0), 0),
                    'Capacidad provisionada',
                    'Inventario sincronizado',
                  ],
                  [
                    HardDrive,
                    'Memoria asignada',
                    `${vms.reduce((s, v) => s + Number(v.memory_mb ?? 0), 0) / 1024} GB`,
                    'Memoria provisionada',
                    'En todos los entornos',
                  ],
                ].map(([Icon, label, value, foot, note]) => {
                  const I = Icon as typeof Cpu;
                  return (
                    <section className="stat-card" key={String(label)}>
                      <div className="stat-label">
                        {String(label)}
                        <I size={18} />
                      </div>
                      <div className="stat-value">{String(value)}</div>
                      <div className="stat-foot">
                        <span>{String(foot)}</span>
                        <small>{String(note)}</small>
                      </div>
                    </section>
                  );
                })}
              </div>
              <div className="dashboard-middle">
                <section className="panel capacity-panel">
                  <div className="section-head">
                    <div>
                      <h2>Actividad de infraestructura</h2>
                      <p>Máquinas en ejecución{demo ? ' · muestra de demostración' : ''}</p>
                    </div>
                    <span className="chart-period">
                      <Clock size={14} />
                      {demo ? 'Últimas 24 horas' : 'Esta sesión'}
                    </span>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="legend-blue" />
                      Máquinas activas
                    </span>
                    <span className="muted">
                      {demo ? 'Datos de ejemplo' : 'Muestras recibidas de la API'}
                    </span>
                  </div>
                  <div className="chart">
                    <div className="chart-y">
                      <span>{demo ? '6' : Math.max(1, ...history)}</span>
                      <span>{demo ? '3' : Math.round(Math.max(1, ...history) / 2)}</span>
                      <span>0</span>
                    </div>
                    <svg
                      viewBox="0 0 720 170"
                      preserveAspectRatio="none"
                      role="img"
                      aria-label="Máquinas activas a lo largo del tiempo"
                    >
                      <defs>
                        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4e88ff" stopOpacity=".30" />
                          <stop offset="100%" stopColor="#4e88ff" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {[15, 80, 150].map((y) => (
                        <line
                          key={y}
                          x1="0"
                          y1={y}
                          x2="720"
                          y2={y}
                          stroke="#273147"
                          strokeDasharray="3 5"
                        />
                      ))}
                      {(() => {
                        const values = demo
                          ? [2, 2, 3, 3, 3, 2, 4, 4, 3, 4, 4, 3, 5, 4, 5, 5, 4, 5, 5, 5]
                          : history;
                        const max = demo ? 6 : Math.max(1, ...values);
                        const points = values
                          .map(
                            (v, i) =>
                              `${(i * 720) / Math.max(values.length - 1, 1)},${150 - (v / max) * 130}`,
                          )
                          .join(' ');
                        return (
                          <>
                            <polygon points={`0,150 ${points} 720,150`} fill="url(#area)" />
                            <polyline
                              points={points}
                              fill="none"
                              stroke="#6599ff"
                              strokeWidth="2.5"
                              strokeLinejoin="round"
                            />
                          </>
                        );
                      })()}
                    </svg>
                  </div>
                  <div className="chart-x">
                    {(demo
                      ? ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', 'Ahora']
                      : ['Inicio de sesión', 'Ahora']
                    ).map((v) => (
                      <span key={v}>{v}</span>
                    ))}
                  </div>
                </section>
                <section className="panel provider-panel">
                  <div className="section-head">
                    <h2>Entornos conectados</h2>
                    <Layers3 size={17} className="muted" />
                  </div>
                  {infra.length === 0 ? (
                    <Empty />
                  ) : (
                    infra.map((i) => (
                      <button
                        key={String(i.id)}
                        className="infra-mini"
                        onClick={() => navigate('/infrastructure')}
                      >
                        <div className={'provider-icon ' + i.type}>
                          {i.type === 'kubernetes' ? <Boxes size={21} /> : <Server size={21} />}
                        </div>
                        <div>
                          <strong>{String(i.name)}</strong>
                          <small>
                            {String(
                              i.type === 'proxmox'
                                ? 'Proxmox VE'
                                : i.type === 'xcpng'
                                  ? 'XCP-ng'
                                  : i.type,
                            )}
                          </small>
                        </div>
                        <span
                          className={'status-dot ' + (i.status === 'connected' ? 'green' : 'amber')}
                        />
                      </button>
                    ))
                  )}
                  <NavLink to="/infrastructure" className="text-link">
                    Gestionar infraestructuras <ArrowUpRight size={15} />
                  </NavLink>
                </section>
              </div>
              <section className="panel">
                <div className="section-head">
                  <div>
                    <h2>
                      Máquinas virtuales <span className="count">{vms.length}</span>
                    </h2>
                    <p>Inventario unificado de tus hipervisores</p>
                  </div>
                  <NavLink to="/vms" className="text-link">
                    Ver todas <ArrowUpRight size={15} />
                  </NavLink>
                </div>
                {vms.length ? resourceTable(vms.slice(0, 6), columns['/vms']) : <Empty />}
              </section>
              <div className="dashboard-footer">
                <span>
                  <Shield size={14} /> Conexiones cifradas · acceso controlado por roles
                </span>
                <span>
                  {demo ? 'Muestra de producto' : 'Datos del inventario de NEXUS'}{' '}
                  <span className="mono">API v1</span>
                </span>
              </div>
            </>
          ) : path === '/kubernetes' ? (
            <KubernetesView demo={demo} infra={infra} notify={notify} />
          ) : path === '/ldap' ? (
            <section className="panel form-panel">
              <h2>Directorio de identidades</h2>
              <p className="muted">
                Conexión LDAPS con verificación de certificados y mapeo de grupos.
              </p>
              <Fields
                fields={[
                  {
                    key: 'url',
                    label: 'URL LDAPS',
                    initial: 'ldaps://ad.example.com:636',
                    required: true,
                  },
                  { key: 'bindDN', label: 'Bind DN', required: true },
                  {
                    key: 'bindCredentials',
                    label: 'Contraseña de servicio',
                    type: 'password',
                    required: true,
                  },
                  {
                    key: 'searchBase',
                    label: 'Base de búsqueda',
                    initial: 'dc=example,dc=com',
                    required: true,
                  },
                  { key: 'searchFilter', label: 'Filtro', initial: '(objectClass=person)' },
                  {
                    key: 'usernameAttribute',
                    label: 'Atributo de usuario',
                    initial: 'sAMAccountName',
                  },
                  {
                    key: 'groupMapping',
                    label: 'Mapeo de grupos a roles (JSON)',
                    type: 'textarea',
                    initial: '{}',
                  },
                  { key: 'caCert', label: 'Certificado CA (PEM)', type: 'textarea' },
                  {
                    key: 'active',
                    label: 'Habilitar autenticación LDAP',
                    type: 'checkbox',
                    initial: false,
                  },
                ]}
                submit={async (v) => {
                  guard();
                  const b = {
                    ...v,
                    groupMapping: JSON.parse(String(v.groupMapping)),
                    tlsEnabled: true,
                  };
                  await post('/ldap/test', b);
                  await api('/ldap/config', { method: 'PUT', body: JSON.stringify(b) });
                  notify('Conexión validada y configuración guardada');
                }}
                label="Probar conexión y guardar"
              />
              <Button
                variant="outline"
                onClick={() =>
                  void action('/ldap/sync', 'Usuarios sincronizados').catch((e) =>
                    notify(e.message),
                  )
                }
              >
                <RefreshCw size={16} /> Sincronizar usuarios
              </Button>
            </section>
          ) : path === '/maintenance' ? (
            <section className="panel form-panel">
              <div className="section-head">
                <h2>Ventana de mantenimiento</h2>
                <Badge value={maintenance} />
              </div>
              <p className="muted">
                Restringe las escrituras y avisa a los usuarios de la plataforma.
              </p>
              <Fields
                fields={[
                  {
                    key: 'message',
                    label: 'Mensaje',
                    initial: 'Mantenimiento programado. Volvemos pronto.',
                    required: true,
                  },
                  {
                    key: 'allowedIPs',
                    label: 'IPs de administradores exceptuadas (separadas por comas)',
                  },
                  {
                    key: 'scheduledStart',
                    label: 'Inicio programado (opcional)',
                    type: 'datetime-local',
                  },
                  {
                    key: 'scheduledEnd',
                    label: 'Fin programado (opcional)',
                    type: 'datetime-local',
                  },
                ]}
                submit={async (v) => {
                  guard();
                  await post('/maintenance/enable', {
                    message: v.message,
                    allowedIPs: String(v.allowedIPs)
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                    scheduledStart: v.scheduledStart
                      ? new Date(String(v.scheduledStart)).toISOString()
                      : undefined,
                    scheduledEnd: v.scheduledEnd
                      ? new Date(String(v.scheduledEnd)).toISOString()
                      : undefined,
                  });
                  notify('Mantenimiento configurado');
                  refresh();
                }}
                label="Activar o programar"
              />
              <Button
                variant="outline"
                onClick={() =>
                  void action('/maintenance/disable', 'Mantenimiento desactivado').catch((e) =>
                    notify(e.message),
                  )
                }
              >
                Desactivar mantenimiento
              </Button>
            </section>
          ) : path === '/export-import' ? (
            <ExportImport demo={demo} notify={notify} />
          ) : path === '/settings' ? (
            <section className="panel form-panel">
              <h2>Plataforma</h2>
              <dl className="settings-list">
                <dt>Producto</dt>
                <dd>m4m0 NEXUS</dd>
                <dt>Versión</dt>
                <dd className="mono">0.1.0</dd>
                <dt>API REST</dt>
                <dd className="mono">/api/v1</dd>
                <dt>Zona horaria de backups</dt>
                <dd>UTC</dd>
                <dt>Despliegue</dt>
                <dd>Docker Compose / Kubernetes</dd>
                <dt>Autenticación</dt>
                <dd>JWT + LDAP / AD</dd>
              </dl>
              <p className="muted">
                Los endpoints, certificados y secretos del despliegue se configuran en el servidor.
              </p>
              <Button variant="outline" onClick={() => navigate('/ldap')}>
                Configurar directorio <ArrowUpRight size={15} />
              </Button>
            </section>
          ) : columns[path] ? (
            <>
              <section className="panel">
                <div className="list-toolbar">
                  <div className="search-box">
                    <Search size={17} />
                    <input
                      aria-label="Buscar recursos"
                      placeholder="Buscar recursos…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <span className="count">{filtered.length}</span>
                  </div>
                  {['/hosts', '/storage'].includes(path) ? (
                    <select
                      aria-label="Seleccionar infraestructura"
                      value={selectedInfra}
                      onChange={(e) => setSelectedInfra(e.target.value)}
                    >
                      <option value="">Selecciona una infraestructura</option>
                      {infra.map((i) => (
                        <option key={String(i.id)} value={String(i.id)}>
                          {String(i.name)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted">
                      {loading ? 'Sincronizando…' : `${filtered.length} recursos`}
                    </span>
                  )}
                </div>
                {loading ? (
                  <div className="empty">
                    <RefreshCw className="spin" /> Cargando recursos…
                  </div>
                ) : filtered.length ? (
                  resourceTable(
                    filtered,
                    columns[path],
                    path !== '/audit' && path !== '/hosts' && path !== '/storage',
                  )
                ) : (
                  <Empty
                    title={search ? 'Sin resultados' : 'No hay recursos'}
                    text={
                      search
                        ? 'Prueba con otro nombre o estado.'
                        : demo
                          ? 'No hay registros de ejemplo para esta vista.'
                          : 'Añade un recurso o selecciona una infraestructura.'
                    }
                  />
                )}
              </section>
              {path === '/backup' && (
                <BackupHistory demo={demo} revision={revision} notify={notify} />
              )}
            </>
          ) : (
            <Empty title="Página no encontrada" text="Selecciona una sección del menú." />
          )}
        </main>
        <footer className="app-footer">
          <span>© 2026 m4m0 consulting</span>
          <span>
            m4m0 NEXUS <span className="footer-dot">·</span> Infrastructure, unified.
          </span>
        </footer>
      </div>
      <Dialog
        open={newResource}
        onOpenChange={setNewResource}
        title={
          path === '/infrastructure'
            ? 'Añadir infraestructura'
            : `Crear · ${titles[path] ?? 'recurso'}`
        }
      >
        <Fields
          key={path + String(newResource)}
          fields={fieldSets[path] ?? infraFields}
          submit={async (v) => {
            guard();
            const r = await post<Row>(endpoint, transform(path, v));
            if (r.token) setOneTime(String(r.token));
            setNewResource(false);
            notify('Recurso creado');
            refresh();
          }}
        />
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={() => setEditing(null)}
        title={`Editar ${editing?.name ?? editing?.email ?? 'recurso'}`}
        description="Los campos secretos vacíos se conservan donde el servicio admite actualización parcial."
      >
        {editing && (
          <Fields
            fields={
              path === '/users'
                ? [
                    { key: 'role', label: 'Rol', options: ['readonly', 'user', 'admin'] },
                    { key: 'active', label: 'Cuenta activa', type: 'checkbox' },
                    { key: 'password', label: 'Nueva contraseña (opcional)', type: 'password' },
                  ]
                : (fieldSets[path] ?? [])
            }
            initial={{
              ...editing,
              events: Array.isArray(editing.events) ? editing.events.join(', ') : '',
              headers: '{}',
              scopes: Array.isArray(editing.scopes) ? editing.scopes.join(', ') : '',
              targets: Array.isArray(editing.targets) ? editing.targets.join(', ') : '',
              retention: editing.retention_days,
              storageType: editing.storage_type,
            }}
            submit={async (v) => {
              guard();
              const body =
                path === '/users'
                  ? { ...v, password: v.password || undefined }
                  : transform(path, v);
              await api(`${endpoint}/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
              setEditing(null);
              notify('Cambios guardados');
              refresh();
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!pluginConfig}
        onOpenChange={() => setPluginConfig(null)}
        title="Configurar plugin"
      >
        <Fields
          fields={[
            { key: 'config', label: 'Configuración (JSON)', type: 'textarea', initial: '{}' },
          ]}
          submit={async (v) => {
            guard();
            await api(`/plugins/${pluginConfig?.id}`, {
              method: 'PUT',
              body: JSON.stringify({ config: JSON.parse(String(v.config)) }),
            });
            setPluginConfig(null);
            notify('Configuración guardada');
          }}
        />
      </Dialog>
      <Dialog
        open={!!oneTime}
        onOpenChange={() => setOneTime('')}
        title="Token creado"
        description="Cópialo ahora. NEXUS no volverá a mostrarlo."
      >
        <pre className="token-value">{oneTime}</pre>
        <Button
          onClick={() =>
            void navigator.clipboard
              .writeText(oneTime)
              .then(() => notify('Token copiado'))
              .catch(() => notify('No se pudo copiar. Selecciona el token manualmente.'))
          }
        >
          Copiar token
        </Button>
      </Dialog>
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)} title="Detalle del recurso">
        {detail}
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={() => setConfirm(null)}
        title={confirm?.title ?? 'Confirmar operación'}
        description="Esta acción se ejecutará sobre tu infraestructura."
      >
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const c = confirm;
              setConfirm(null);
              void c?.action().catch((e) => notify(e.message));
            }}
          >
            Confirmar
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={login}
        onOpenChange={setLogin}
        title={identity ? 'Sesión de NEXUS' : 'Conecta tu entorno'}
        description={
          identity ? identity.email : 'Inicia sesión con tu cuenta local o de directorio.'
        }
      >
        {identity ? (
          <Button
            variant="outline"
            onClick={() => {
              void post('/auth/logout').finally(() => {
                setAccessToken('');
                setIdentity(null);
                setDemo(true);
                setLogin(false);
                navigate('/');
              });
            }}
          >
            <LogOut size={16} /> Cerrar sesión
          </Button>
        ) : (
          <Fields
            fields={[
              { key: 'username', label: 'Usuario o correo electrónico', required: true },
              { key: 'password', label: 'Contraseña', type: 'password', required: true },
              { key: 'source', label: 'Autenticación', options: ['local', 'ldap'] },
            ]}
            label="Iniciar sesión"
            submit={async (v) => {
              const r = await post<{ accessToken: string; user: Identity }>('/auth/login', v);
              setAccessToken(r.accessToken);
              setIdentity(r.user);
              setDemo(false);
              setLogin(false);
              refresh();
              notify('Conectado a tu entorno');
            }}
          />
        )}
      </Dialog>
      {message && (
        <div className="toast" role="status">
          <Activity size={18} />
          {message}
          <button aria-label="Cerrar aviso" onClick={() => setMessage('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
