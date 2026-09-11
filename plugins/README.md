# Plugins de NEXUS

Un plugin se instala primero como archivos locales revisados; la API solo registra su ID. No hay descarga ni ejecución de paquetes remotos.

```text
plugins/my-plugin/
  manifest.json
  package.json
  index.js
```

`manifest.json`:

```json
{"id":"my-plugin","name":"My plugin","version":"1.0.0","description":"Operational policy","author":"Your team","entryPoint":"index.js"}
```

`package.json` debe declarar `"type":"module"`. `index.js` exporta por defecto un objeto con `hooks`:

```javascript
export default {
  hooks: [{
    event: 'vm.beforeStart',
    async handler(data, settings) {
      if (settings.blockedVMs?.includes(data.vmId)) {
        throw new Error('VM is blocked by policy');
      }
    }
  }]
};
```

Hooks cableados: `vm.beforeStart`, `vm.afterStop`, `infrastructure.afterSync`, `user.afterLogin`, `api.beforeRequest` y los eventos emitidos por WebhookService. Los dos últimos registran fallos sin deshacer una operación externa ya completada. Los eventos de marketplace no están cableados en 0.1.0.

Instala con `POST /api/v1/plugins {"id":"my-plugin"}`, configura con `PUT /api/v1/plugins/my-plugin {"config":{"blockedVMs":[]}}`, activa con `POST /api/v1/plugins/my-plugin/enable`. El registro es independiente de los archivos: eliminarlo no borra el módulo.

`GET /api/v1/plugins/my-plugin/logs` devuelve eventos auditados de ejecución. Un hook tiene 5 segundos y un heap de 64 MB; se ejecuta en un proceso hijo sin el entorno de secretos del backend. Eso **no** es un sandbox para código malicioso. No hay garantía de aislamiento de filesystem/red; los plugins pertenecen a la base de confianza del despliegue. No pongas secretos en `config`.

En desarrollo ejecuta `npm run build -w backend` antes de probar hooks: el runner hijo usa el JavaScript compilado. En Docker forma parte de la imagen. Para actualizar código, revísalo, reemplaza los archivos y reinicia/desactiva/activa el plugin; la versión de metadata no se sincroniza automáticamente desde un marketplace.
