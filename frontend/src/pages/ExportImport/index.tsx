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
export default function ExportImport({
  demo,
  notify,
}: {
  demo: boolean;
  notify: (m: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <div className="two-columns">
      <section className="panel form-panel">
        <h2>Exportar configuración</h2>
        <p className="muted">Selecciona los datos que quieres conservar.</p>
        <Fields
          fields={[
            {
              key: 'includeInfrastructures',
              label: 'Infraestructuras',
              type: 'checkbox',
              initial: true,
            },
            { key: 'includeUsers', label: 'Usuarios', type: 'checkbox' },
            { key: 'includeWebhooks', label: 'Webhooks', type: 'checkbox', initial: true },
            { key: 'includeTokens', label: 'Hashes de API tokens', type: 'checkbox' },
            { key: 'includeAuditLogs', label: 'Historial de auditoría', type: 'checkbox' },
            { key: 'format', label: 'Formato', options: ['json', 'sql'] },
            { key: 'encrypt', label: 'Cifrar con contraseña', type: 'checkbox', initial: true },
            {
              key: 'encryptionPassword',
              label: 'Contraseña (mínimo 16 caracteres)',
              type: 'password',
            },
          ]}
          label="Exportar y descargar"
          submit={async (v) => {
            if (demo) throw new Error('Inicia sesión para exportar tu configuración.');
            const r = await post<{ id: string }>('/export', {
              ...v,
              encryptionPassword: v.encryptionPassword || undefined,
            });
            await download(`/export/${r.id}`, 'nexus-config.nexus');
            notify('Exportación descargada');
          }}
        />
      </section>
      <section className="panel form-panel">
        <h2>Importar configuración</h2>
        <p className="muted">
          Importa un archivo JSON de NEXUS, cifrado o sin cifrar. Necesitas la clave del servidor de
          origen para restaurar credenciales.
        </p>
        <label className="file-input">
          <ArrowDownToLine size={28} />
          <span>{file?.name ?? 'Seleccionar archivo NEXUS'}</span>
          <input
            aria-label="Archivo de configuración"
            type="file"
            accept=".nexus,.json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <Fields
          fields={[
            { key: 'password', label: 'Contraseña de cifrado (si procede)', type: 'password' },
          ]}
          label="Validar e importar"
          submit={async (v) => {
            if (demo) throw new Error('Inicia sesión para importar una configuración.');
            if (!file) throw new Error('Selecciona un archivo');
            if (file.size > 20 * 1024 * 1024) throw new Error('El límite es 20 MB');
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = '';
            for (const b of bytes) binary += String.fromCharCode(b);
            const r = await post<{ restored: number }>('/import', {
              data: btoa(binary),
              password: v.password || undefined,
            });
            notify(`${r.restored} registros añadidos`);
          }}
        />
      </section>
    </div>
  );
}
