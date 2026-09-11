import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { post } from '../services/api';
export function KubernetesTerminal({
  clusterId,
  namespace,
  pod,
  container,
  mode,
}: {
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
  mode: 'exec' | 'logs';
}) {
  const target = useRef<HTMLDivElement>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | undefined;
    const term = new Terminal({
      fontFamily: 'JetBrains Mono,monospace',
      fontSize: 13,
      convertEol: true,
      theme: { background: '#070d17', foreground: '#cbd8ec' },
      cursorBlink: mode === 'exec',
      disableStdin: mode === 'logs',
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(target.current!);
    fit.fit();
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(target.current!);
    const input = term.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN && mode === 'exec') socket.send(data);
    });
    void (async () => {
      const result = await post<{ token: string }>(
        `/kubernetes/clusters/${clusterId}/session/token`,
        { namespace, pod, container, mode, command: ['/bin/sh'] },
      );
      if (cancelled) return;
      const suffix = mode === 'logs' ? 'logs/stream' : 'exec';
      socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/kubernetes/clusters/${clusterId}/namespaces/${namespace}/pods/${pod}/${suffix}`,
        ['nexus-ticket.' + result.token],
      );
      socket.onmessage = (e) => term.write(String(e.data));
      socket.onopen = () => term.focus();
      socket.onerror = () =>
        setError('No se pudo abrir la sesión. Comprueba los permisos del cluster.');
      socket.onclose = () => term.writeln('\r\n[Sesión finalizada]');
    })().catch((e) => setError(e.message));
    return () => {
      cancelled = true;
      socket?.close();
      input.dispose();
      observer.disconnect();
      term.dispose();
    };
  }, [clusterId, namespace, pod, container, mode]);
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div
        ref={target}
        style={{ height: 420, width: '100%', padding: 10, background: '#070d17' }}
      />
    </>
  );
}
