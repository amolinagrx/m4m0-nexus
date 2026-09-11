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
export default function BackupHistory({
  demo,
  revision,
  notify,
}: {
  demo: boolean;
  revision: number;
  notify: (m: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [restore, setRestore] = useState('');
  useEffect(() => {
    if (demo) setRows(demoData['/backups/history']);
    else
      void api<Row[]>('/backups/history')
        .then(setRows)
        .catch((e) => notify(e.message));
  }, [demo, revision]);
  return (
    <section className="panel history-panel">
      <div className="section-head">
        <h2>Historial de ejecuciones</h2>
        <FileClock size={18} />
      </div>
      {rows.length ? (
        rows.map((r) => (
          <div className="history-row" key={String(r.id)}>
            <Database size={20} />
            <div>
              <strong>{String(r.id).slice(0, 12)}</strong>
              <small>{new Date(String(r.started_at)).toLocaleString('es-ES')}</small>
            </div>
            <Badge value={r.status} />
            <span className="muted">
              {r.backup_size_bytes ? (Number(r.backup_size_bytes) / 1024).toFixed(1) + ' KB' : '—'}
            </span>
            {r.status === 'completed' && (
              <>
                <Button
                  variant="ghost"
                  title="Descargar"
                  onClick={() =>
                    demo
                      ? notify('El backup es un ejemplo.')
                      : void download(`/backups/${r.id}/download`, 'nexus-backup.nexus').catch(
                          (e) => notify(e.message),
                        )
                  }
                >
                  <Download size={17} />
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    demo ? notify('El backup es un ejemplo.') : setRestore(String(r.id))
                  }
                >
                  Restaurar
                </Button>
              </>
            )}
          </div>
        ))
      ) : (
        <Empty title="Sin ejecuciones" text="Las copias aparecerán aquí al ejecutar un job." />
      )}
      <Dialog
        open={!!restore}
        onOpenChange={() => setRestore('')}
        title="Restaurar configuración"
        description="Se añadirán los registros que falten. Los registros existentes se conservan."
      >
        <Fields
          fields={[
            { key: 'password', label: 'Contraseña de cifrado (si procede)', type: 'password' },
          ]}
          label="Restaurar"
          submit={async (v) => {
            await post(`/backups/${restore}/restore`, v);
            setRestore('');
            notify('Configuración restaurada');
          }}
        />
      </Dialog>
    </section>
  );
}
