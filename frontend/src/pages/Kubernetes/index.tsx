import { useEffect, useState, lazy, Suspense } from 'react';
import {
  ArrowDownToLine,
  Database,
  Download,
  FileClock,
  RefreshCw,
  Box,
  Terminal,
} from 'lucide-react';
import { api, post, download } from '../../services/api';
import { demoData, type Row } from '../../services/demo';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Empty, Badge, Fields } from '../../components/ResourceUI';
const KubernetesTerminal = lazy(() =>
  import('../../components/KubernetesTerminal').then((m) => ({ default: m.KubernetesTerminal })),
);
export default function KubernetesView({
  demo,
  infra,
  notify,
}: {
  demo: boolean;
  infra: Row[];
  notify: (m: string) => void;
}) {
  const clusters = infra.filter((i) => i.type === 'kubernetes');
  const [cluster, setCluster] = useState(''),
    [ns, setNS] = useState('default'),
    [namespaces, setNamespaces] = useState<string[]>(['default']),
    [resource, setResource] = useState('pods'),
    [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [logs, setLogs] = useState('');
  const [stream, setStream] = useState<{
    pod: string;
    container: string;
    mode: 'exec' | 'logs';
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const selected = cluster || String(clusters[0]?.id ?? '');
  useEffect(() => {
    if (!selected) return;
    if (demo) {
      setNamespaces(['default', 'production', 'monitoring', 'kube-system']);
      return;
    }
    void api<Row[]>(`/kubernetes/clusters/${selected}/namespaces`)
      .then((r) => setNamespaces(r.map((x) => String((x.metadata as Row)?.name))))
      .catch((e) => notify(e.message));
  }, [selected, demo]);
  useEffect(() => {
    if (!selected) return;
    if (demo) {
      setRows(
        resource === 'pods'
          ? [
              {
                metadata: { name: 'api-gateway-7b4fd-x9w2', namespace: ns },
                status: { phase: 'Running' },
                spec: { nodeName: 'worker-01' },
              },
              {
                metadata: { name: 'frontend-6f7cc-j8k4', namespace: ns },
                status: { phase: 'Running' },
                spec: { nodeName: 'worker-02' },
              },
            ]
          : resource === 'deployments'
            ? [
                {
                  metadata: { name: 'api-gateway' },
                  spec: { replicas: 3 },
                  status: { readyReplicas: 3 },
                },
              ]
            : [],
      );
      return;
    }
    setBusy(true);
    void api<Row[]>(`/kubernetes/clusters/${selected}/namespaces/${ns}/${resource}`)
      .then(setRows)
      .catch((e) => {
        notify(e.message);
        setRows([]);
      })
      .finally(() => setBusy(false));
  }, [selected, ns, resource, demo, revision]);
  const [scale, setScale] = useState('');
  return (
    <section className="panel">
      <div className="list-toolbar">
        <select aria-label="Cluster" value={selected} onChange={(e) => setCluster(e.target.value)}>
          <option value="">Seleccionar cluster</option>
          {clusters.map((c) => (
            <option value={String(c.id)} key={String(c.id)}>
              {String(c.name)}
            </option>
          ))}
        </select>
        <select aria-label="Namespace" value={ns} onChange={(e) => setNS(e.target.value)}>
          {namespaces.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
          <RefreshCw size={16} /> Actualizar
        </Button>
      </div>
      <div className="tabs">
        {['pods', 'deployments', 'services', 'ingress', 'pvcs', 'configmaps', 'secrets'].map(
          (r) => (
            <button
              key={r}
              className={r === resource ? 'selected' : ''}
              onClick={() => setResource(r)}
            >
              {r}
            </button>
          ),
        )}
      </div>
      {busy ? (
        <div className="empty">Cargando recursos…</div>
      ) : rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Recurso</th>
                <th>Namespace</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const meta = r.metadata as Row,
                  status = r.status as Row | undefined;
                const name = String(meta?.name);
                return (
                  <tr key={i}>
                    <td>
                      <Box size={16} className="inline-icon" />
                      <strong>{name}</strong>
                    </td>
                    <td className="mono muted">{String(meta?.namespace ?? ns)}</td>
                    <td>
                      {resource === 'pods' ? (
                        <Badge value={String(status?.phase ?? 'unknown').toLowerCase()} />
                      ) : resource === 'deployments' ? (
                        `${status?.readyReplicas ?? 0} / ${(r.spec as Row)?.replicas ?? 0} listas`
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {resource === 'pods' ? (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => {
                              if (demo) {
                                setLogs(
                                  'Vista de demostración. Conecta un cluster para consultar logs reales.',
                                );
                                return;
                              }
                              void api<{ logs: string }>(
                                `/kubernetes/clusters/${selected}/namespaces/${ns}/pods/${name}/logs`,
                              )
                                .then((x) => setLogs(x.logs))
                                .catch((e) => notify(e.message));
                            }}
                          >
                            <Terminal size={15} /> Logs
                          </Button>
                          {['logs', 'exec'].map((mode) => (
                            <Button
                              key={mode}
                              variant="ghost"
                              onClick={() => {
                                if (demo) {
                                  notify(
                                    'Conecta un cluster para abrir una sesión en tiempo real.',
                                  );
                                  return;
                                }
                                const containers =
                                  (r.spec as { containers?: { name: string }[] })?.containers ?? [];
                                setStream({
                                  pod: name,
                                  container: containers[0]?.name ?? '',
                                  mode: mode as 'logs' | 'exec',
                                });
                              }}
                            >
                              {mode === 'exec' ? 'Terminal' : 'Seguir logs'}
                            </Button>
                          ))}
                        </>
                      ) : resource === 'deployments' ? (
                        <Button variant="outline" onClick={() => setScale(name)}>
                          Escalar
                        </Button>
                      ) : (
                        <Button variant="ghost" onClick={() => setLogs(JSON.stringify(r, null, 2))}>
                          Ver detalle
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title={selected ? 'Sin recursos en este namespace' : 'Conecta un cluster Kubernetes'}
          text="Añade un cluster desde Infraestructuras y selecciona su namespace."
        />
      )}
      <Dialog open={!!logs} onOpenChange={() => setLogs('')} title="Detalle de Kubernetes">
        <pre className="log-view">{logs}</pre>
      </Dialog>
      <Dialog
        open={!!stream}
        onOpenChange={() => setStream(null)}
        title={stream?.mode === 'exec' ? 'Terminal del contenedor' : 'Logs en tiempo real'}
      >
        {stream && (
          <Suspense fallback={<p>Cargando terminal…</p>}>
            <KubernetesTerminal
              clusterId={selected}
              namespace={ns}
              pod={stream.pod}
              container={stream.container}
              mode={stream.mode}
            />
          </Suspense>
        )}
      </Dialog>
      <Dialog open={!!scale} onOpenChange={() => setScale('')} title={`Escalar ${scale}`}>
        <Fields
          fields={[
            {
              key: 'replicas',
              label: 'Número de réplicas',
              type: 'number',
              initial: 3,
              required: true,
            },
          ]}
          label="Aplicar"
          submit={async (v) => {
            if (demo) throw new Error('Conecta un cluster para escalar deployments.');
            await post(
              `/kubernetes/clusters/${selected}/namespaces/${ns}/deployments/${scale}/scale`,
              v,
            );
            setScale('');
            setRevision((x) => x + 1);
            notify('Réplicas actualizadas');
          }}
        />
      </Dialog>
    </section>
  );
}
