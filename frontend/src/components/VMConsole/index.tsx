import { useEffect, useRef, useState } from 'react';
import { Maximize } from 'lucide-react';
import { api } from '../../services/api';
import { Button } from '../ui/button';
export function VMConsole({ vmId }: { vmId: string }) {
  const screen = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Conectando…');
  useEffect(() => {
    let cancelled = false;
    let client: { disconnect: () => void } | undefined;
    void (async () => {
      const ticket = await api<{ token: string; password?: string }>(`/vms/${vmId}/console/token`);
      const { default: RFB } = await import('@novnc/novnc');
      if (cancelled || !screen.current) return;
      const rfb = new RFB(
        screen.current,
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/vms/${vmId}/console`,
        {
          wsProtocols: ['nexus-ticket.' + ticket.token],
          credentials: { password: ticket.password ?? '' },
        },
      );
      client = rfb;
      rfb.scaleViewport = true;
      rfb.resizeSession = true;
      rfb.addEventListener('connect', () => setStatus('Conectado'));
      rfb.addEventListener('disconnect', () => setStatus('Desconectado'));
      rfb.addEventListener('credentialsrequired', () =>
        setError('El proveedor solicita credenciales VNC adicionales.'),
      );
    })().catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
      client?.disconnect();
    };
  }, [vmId]);
  return (
    <>
      <div className="section-head">
        <span className="muted">{status} · sesión de 15 minutos</span>
        <Button variant="outline" onClick={() => void screen.current?.requestFullscreen()}>
          <Maximize size={16} /> Pantalla completa
        </Button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div ref={screen} className="console-screen" />
    </>
  );
}
