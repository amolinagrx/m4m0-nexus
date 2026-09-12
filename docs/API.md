# Referencia API v1

Base: `https://nexus.example.com/api/v1`. JSON en peticiones/respuestas salvo downloads y WebSocket. UUID internos para `:id`; nombres DNS para namespaces/pods. Auth: `Authorization: Bearer <JWT o nexus_token_...>`.

`/docs` del backend expone OpenAPI generado bajo autenticación; el proxy de producción no lo publica por defecto. El inventario de rutas se genera automáticamente; los contratos de cuerpo detallados están en los esquemas Zod y en los ejemplos de esta guía.

## Sesiones

| Método | Ruta            | Cuerpo / respuesta                                                |
| ------ | --------------- | ----------------------------------------------------------------- |
| POST   | `/auth/login`   | `{username,password,source:"local"                                | "ldap"}` → accessToken, user y cookie refresh HttpOnly |
| POST   | `/auth/refresh` | Cookie refresh + Origin exacto → nuevo accessToken y nueva cookie |
| POST   | `/auth/logout`  | Cookie refresh + Origin → revoca familia y borra cookie           |
| GET    | `/auth/me`      | Cuenta autenticada                                                |

No almacenes el refresh token en JavaScript. El frontend guarda accessToken solo en memoria y renueva bajo demanda al recibir un 401.

## Inventario y VM

| Método         | Ruta                                                           | Scope                    |
| -------------- | -------------------------------------------------------------- | ------------------------ |
| GET/POST       | `/infrastructure`                                              | infra:read / infra:write |
| GET/PUT/DELETE | `/infrastructure/:id`                                          | infra:read / infra:write |
| POST           | `/infrastructure/:id/sync`                                     | infra:write              |
| GET/POST       | `/vms`                                                         | vms:read / vms:write     |
| GET/DELETE     | `/vms/:id`                                                     | vms:read / vms:write     |
| POST           | `/vms/:id/start`, `/stop`, `/restart`, `/snapshot`, `/migrate` | vms:write                |
| GET            | `/vms/:id/metrics`                                             | vms:read                 |
| GET            | `/hosts?infrastructureId=UUID`                                 | hosts:read               |
| GET            | `/storage?infrastructureId=UUID`                               | storage:read             |
| GET            | `/networks?infrastructureId=UUID`                              | infra:read               |

Crear infraestructura:

```json
{
  "name": "proxmox-prod",
  "type": "proxmox",
  "endpoint": "https://pve.example.com:8006",
  "credentials": {
    "tokenId": "nexus@pve!automation",
    "token": "secret-value",
    "caCert": "PEM si procede"
  }
}
```

La creación no realiza una conexión externa automáticamente. Sincroniza para verificar acceso y persistir inventario. Los errores de sincronización dejan `status=error`. La actualización conserva claves de credenciales no suministradas y no permite cambiar el proveedor. Para rotar una contraseña, envía su nuevo valor.

Snapshot: `{"name":"before-upgrade"}`. Migración: `{"targetHost":"pve-node-02"}`. Las acciones de energía admiten `{}`. El borrado de una infraestructura elimina su registro e inventario de NEXUS; no borra las VM remotas. `DELETE /vms/:id` sí elimina la VM del hipervisor.

Crear VM Proxmox desde una plantilla:

```json
{
  "infrastructure_id": "UUID",
  "name": "web-server-01",
  "template_id": "pve-node-01/qemu/9000",
  "cpus": 4,
  "memory_mb": 8192,
  "disk_gb": 100
}
```

## Usuarios y API tokens

| Método         | Ruta                 | Scope                             |
| -------------- | -------------------- | --------------------------------- |
| GET/POST       | `/users`             | users:read / users:write          |
| GET/PUT/DELETE | `/users/:id`         | users:read / users:write          |
| GET/POST       | `/tokens`            | tokens:read / tokens:write        |
| GET/DELETE     | `/tokens/:id`        | tokens:read / tokens:write        |
| POST           | `/tokens/:id/rotate` | tokens:write + sesión interactiva |

Usuario nuevo: `{email,password,role,active?}`; contraseña mínima de 16 caracteres. Editar: `{role,active,password?}`. No puedes quitar tu propio acceso administrativo ni borrar tu propia cuenta.

Crear token: `{name,scopes:["vms:read"],expiresAt?:"2027-01-01T00:00:00Z"}`. Respuesta 201 contiene `token` **una sola vez**. Listado/GET nunca devuelve hashes ni secretos. Todos los endpoints de tokens limitan datos al propietario autenticado.

## Webhooks

GET/POST `/webhooks`; GET/PUT/DELETE `/webhooks/:id`; POST `/webhooks/:id/test`; GET `/webhooks/:id/logs`. Lectura con `webhooks:read`, escritura con `webhooks:write` y rol admin.

Cuerpo: `{name,url,method?,headers?,events,active?,secret?,retryCount?,timeout?}`. Métodos POST/GET/PUT; retryCount entre 1 y 3; timeout de 1 a 60 segundos. Los campos sensibles se cifran; un secreto omitido en PUT se conserva. `headers` se reemplaza por el nuevo objeto.

Eventos: `vm.started`, `vm.stopped`, `vm.created`, `vm.deleted`, `vm.migrated`, `infrastructure.connected`, `infrastructure.disconnected`, `user.login`, `backup.completed`, `backup.failed`, `alert.triggered`. No todos los eventos del contrato tienen un productor en todos los conectores; por ejemplo, los reinicios no se declaran como un nuevo arranque.

Payload:

```json
{
  "event": "vm.started",
  "timestamp": "2026-09-10T13:45:00Z",
  "data": {
    "vmId": "UUID",
    "vmName": "web-01",
    "infrastructure": "UUID",
    "host": "pve-node-01",
    "triggeredBy": "UUID"
  }
}
```

## LDAP y mantenimiento

GET/PUT `/ldap/config`, POST `/ldap/test`, POST `/ldap/sync`: scopes `settings:read`/`settings:write`, admin. `LDAPConfig` contiene URL LDAPS, bindDN, bindCredentials, searchBase, searchFilter, atributos, tlsEnabled=true, caCert, groupMapping, syncInterval (segundos, mínimo 300), active.

GET `/maintenance/status` es público y solo contiene estado, mensaje y ventana temporal. GET `/maintenance/config` es administrativo e incluye IPs. POST `/maintenance/enable` recibe `{message,allowedIPs?,scheduledStart?,scheduledEnd?}`. Si no hay fecha de inicio, activa inmediatamente. POST `/maintenance/disable` elimina la ventana y desactiva. PUT `/maintenance/message` actualiza `{message}`.

Durante mantenimiento se permiten lecturas, rutas de autenticación y controles administrativos de mantenimiento. Las escrituras requieren que el usuario sea admin y su IP efectiva figure en la excepción. Console/exec se restringen incluso si la apertura usa HTTP GET.

## Backups, exportaciones e importaciones

Todos estos endpoints requieren admin además de `backups:read` o `backups:write`.

| Método     | Ruta                    | Resultado                                     |
| ---------- | ----------------------- | --------------------------------------------- |
| GET/POST   | `/backups/jobs`         | Listar/crear configuración de jobs            |
| PUT/DELETE | `/backups/jobs/:id`     | Editar/eliminar                               |
| POST       | `/backups/jobs/:id/run` | 202, trabajo en cola                          |
| GET        | `/backups/history`      | Últimas 200 ejecuciones                       |
| GET        | `/backups/:id`          | Metadata                                      |
| GET        | `/backups/:id/download` | Binario de copia de configuración             |
| POST       | `/backups/:id/restore`  | `{password?}`, importación transaccional      |
| DELETE     | `/backups/:id`          | Elimina archivo y registro; no admite running |
| POST       | `/export`               | BackupConfig → `{id}`                         |
| GET        | `/export/:id`           | Descarga de exportación del usuario           |
| POST       | `/import`               | `{data:"base64",password?}` → resultado y ID  |
| GET        | `/import/:id/status`    | Resultado de importación del usuario          |

`BackupConfig`: booleanos includeInfrastructures/includeUsers/includeWebhooks/includeTokens/includeAuditLogs, `format:"json"|"sql"`, `encrypt`, `encryptionPassword?`. Máximo 20 MB de contenido de importación; JSON base64 en cuerpo de API.

## Kubernetes

GET/POST `/kubernetes/clusters`; GET `/kubernetes/clusters/:id/namespaces`.

Bajo `/kubernetes/clusters/:id/namespaces/:ns`:

- GET `/pods`, `/deployments`, `/services`, `/ingress`, `/pvcs`, `/configmaps`, `/secrets`.
- GET `/pods/:pod/logs?container=nombre`: hasta 500 líneas.
- POST `/deployments/:name/scale` con `{replicas:0..1000}`.
- POST `/deployments/:name/restart` para rollout mediante anotación del pod template.

Lecturas requieren `kubernetes:read`. Mutaciones y listado de metadatos de secrets requieren `kubernetes:write`. Los valores de secrets no se devuelven desde el listado. El cliente Kubernetes autentica adicionalmente contra los permisos de la cuenta del cluster.

### Streams autenticados

1. POST `/kubernetes/clusters/:id/session/token` con `{namespace,pod,container,mode:"exec"|"logs"|"port-forward",command?:["/bin/sh"],port?:5432}`.
2. Abre WebSocket con subprotocolo `nexus-ticket.<token>` y Origin autorizado:
   - `/kubernetes/clusters/:id/namespaces/:ns/pods/:pod/exec`
   - `/kubernetes/clusters/:id/namespaces/:ns/pods/:pod/logs/stream`
   - `/kubernetes/clusters/:id/namespaces/:ns/pods/:pod/port-forward`
3. Exec recibe stdin y emite stdout/stderr. Logs solo emite texto. Port-forward recibe/emite bytes binarios al puerto solicitado.

El ticket caduca en 30 segundos y solo se puede consumir una vez. El recurso y modo no se pueden cambiar tras emitirlo. Nunca pases el access token en la URL.

## Consola VNC

GET `/vms/:id/console/token` con `vms:write` devuelve ticket temporal y credencial efímera VNC del proveedor. Abre WS `/vms/:id/console` con `nexus-ticket.<token>` y utiliza esa credencial en noVNC. El servidor conecta al upstream aprobado y transporta frames binarios; no acepta hosts arbitrarios enviados por el navegador. El ticket no revela el endpoint upstream ni credenciales de la cuenta de servicio.

POST `/vms/:id/console/send-keys` devuelve 501; las teclas se envían por el cliente VNC. SPICE está declarado en el contrato pero no implementado.

## Plugins, ajustes y auditoría

GET/POST `/plugins`, PUT/DELETE `/plugins/:id`, POST `/plugins/:id/enable`, POST `/plugins/:id/disable`, GET `/plugins/:id/logs`. Administradores con `plugins:read/write`. Instalar recibe `{id}`; configurar recibe `{config:{...}}`.

GET `/settings`: metadata del servicio. GET `/audit?limit=100`: máximo 500 registros, requiere `audit:read` y admin.

## Errores

Formato general: `{"error":"mensaje","requestId":"..."}`; validación añade `issues` con path y mensaje. Códigos: 400 validación, 401 autenticación, 403 autorización, 404 recurso ausente, 409 conflicto, 413 tamaño, 429 límite, 501 capacidad no implementada, 502 fallo de proveedor, 503 mantenimiento/dependencia, 504 tarea remota que no terminó dentro de la espera.

No reintentes a ciegas POST/DELETE tras 5xx o timeout: una mutación externa puede haber comenzado. Los webhooks tienen su propia política de reintentos, separada de las operaciones del hipervisor.

## Docker y Zerobyte

| Método       | Ruta                                                           | Scope                            |
| ------------ | -------------------------------------------------------------- | -------------------------------- |
| GET / POST   | `/docker/hosts`                                                | `docker:read` / `docker:write`   |
| PUT / DELETE | `/docker/hosts/:id`                                            | `docker:write`                   |
| GET          | `/docker/hosts/:id/inventory`                                  | `docker:read`                    |
| POST         | `/docker/hosts/:id/containers`                                 | `docker:write`                   |
| POST         | `/docker/hosts/:id/volumes`                                    | `docker:write`                   |
| POST         | `/docker/hosts/:id/containers/:containerId/action`             | `docker:write`                   |
| GET          | `/docker/hosts/:id/containers/:containerId/logs?tail=200`      | `docker:logs`                    |
| GET / POST   | `/zerobyte/instances`                                          | `backups:read` / `backups:write` |
| PUT / DELETE | `/zerobyte/instances/:id`                                      | `backups:write`                  |
| GET          | `/zerobyte/instances/:id/jobs`, `/resources`, `/history`       | `backups:read`                   |
| POST         | `/zerobyte/instances/:id/jobs`                                 | `backups:write`                  |
| PUT / DELETE | `/zerobyte/instances/:id/jobs/:jobId`                          | `backups:write`                  |
| POST         | `/zerobyte/instances/:id/jobs/:jobId/run`                      | `backups:write`                  |
| GET          | `/zerobyte/instances/:id/repositories/:repositoryId/snapshots` | `backups:read`                   |

`docker:write`, `docker:logs` y los scopes de backups requieren rol admin. Todas las rutas requieren autenticación y se someten al modo mantenimiento y al rate limit de NEXUS. Las mutaciones quedan en auditoría. El inventario no devuelve variables de entorno, opciones de drivers, claves privadas ni configuración de repositorios.

Host: `{name, endpoint, credentials:{caCert?, clientCert, clientKey}}`. Instancia Zerobyte: `{name, endpoint, dockerHostId, credentials:{apiKey, caCert?}}`. Endpoints HTTPS sin paths ni credenciales embebidas. PUT conserva credenciales omitidas únicamente si el endpoint no cambia.

Contenedor: `{name, image, ports:[{containerPort,hostPort,hostIp}], volumes:[{name,target,readOnly}], restartPolicy}`. Imagen y volúmenes deben existir. Devuelve `201` con `Id`; se crea detenido. Volumen: `{name}`. Acción: `{action:"start"|"stop"|"restart"|"pause"|"unpause"|"remove"}`. El borrado devuelve conflicto si está en ejecución y conserva sus volúmenes.

Trabajo Zerobyte: `{name,volumeId,repositoryId,enabled,cronExpression,retentionPolicy:{keepLast:7},includePaths:[],excludePatterns:[]}`. El origen es el `shortId` de un volumen Zerobyte y el repositorio es su `id`. Un PUT no puede cambiar el origen del trabajo. Run devuelve `202` con `{taskId,status:"started"}`; la finalización se consulta en jobs/history. Snapshots usa el `shortId` del repositorio y devuelve tiempos en milisegundos Unix. Las copias de datos y las restauraciones pertenecen a Zerobyte, no a `/backups/:id/restore` de NEXUS.
