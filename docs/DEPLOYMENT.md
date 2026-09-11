# Despliegue y operaciones

## Entornos

`docker-compose.dev.yml` expone PostgreSQL en 127.0.0.1:5432 y Redis en 127.0.0.1:6379 para la API ejecutada en el host. Vite sirve en 127.0.0.1:5173 y hace proxy hacia 127.0.0.1:3001, incluidos upgrades WebSocket de `/api` y Socket.io.

`docker-compose.local.yml` ejecuta la aplicación completa en http://localhost:8080 con nginx como proxy HTTP/WebSocket. `./scripts/deploy.sh local` prepara el entorno, crea el administrador y espera la salud de los servicios. Usa `NEXUS_HTTP_PORT` para cambiar el puerto.

`docker-compose.yml` construye frontend/backend/database y usa Redis y Traefik. En producción solo Traefik publica puertos. No combines los dos archivos con `-f`: los tres son stacks distintos con volúmenes distintos.

## Secretos

Ejecuta `./scripts/deploy.sh init` en un checkout sin `.env`. Utiliza Node dentro de Docker, sin instalarlo en el host. También puedes usar `node scripts/setup-env.mjs` si tienes Node. El script usa exclusión `wx`, permisos 0600 y claves criptográficamente aleatorias. No imprime secretos. Lee y almacena la contraseña bootstrap en tu gestor de contraseñas; El servicio temporal `bootstrap` es el único que recibe la contraseña de administrador. La API de larga duración no la necesita.

- `POSTGRES_PASSWORD`: propietario del esquema `nexus_owner`; no es la conexión de la API.
- `APP_DB_PASSWORD`: cuenta `nexus` con CRUD restringido.
- `DATABASE_URL`: conexión de la cuenta de aplicación; percent-encode si editas passwords con caracteres especiales.
- `REDIS_URL`/`REDIS_PASSWORD`: el valor debe coincidir.
- `JWT_SECRET`: al cambiarlo se invalidan access tokens.
- `ENCRYPTION_KEY`: 32 bytes en hexadecimal. Cambiarlo sin migrar los datos impide descifrarlos.
- `CORS_ORIGIN`: origen exacto del navegador, incluido puerto en desarrollo.
- `WEBHOOK_ALLOWED_ORIGINS`: lista separada por comas de orígenes HTTPS autorizados.

El repositorio excluye `.env`, backups, node_modules y estado de Terraform. Las imágenes no copian `.env`. Los contenedores de frontend/API corren sin root, sin capabilities y con raíz de solo lectura.

## PostgreSQL y migraciones

En un volumen nuevo, la imagen PostgreSQL ejecuta `001_schema.sql` y `002_roles.sh`. La segunda crea el rol de aplicación y retira privilegios de modificación sobre auditoría. Un volumen existente no vuelve a ejecutar esos archivos.

`backend/src/migrate.ts` usa una tabla de versiones y un advisory lock transaccional. Para futuras migraciones debes ejecutarlo con una **conexión de propietario de esquema**, no con la cuenta restringida `nexus`. El esquema actual se instala automáticamente en el primer arranque Docker. El servicio Compose `bootstrap` ejecuta seed con la cuenta de aplicación después de que PostgreSQL esté healthy; la API espera a que termine correctamente. Los arranques posteriores conservan las cuentas existentes.

No uses `docker compose down -v` para actualizar: elimina datos. Para actualizar, toma una copia restaurable, aplica migraciones con el rol de migración y recrea imágenes/contenedores. Fija versiones/digests de imágenes para releases validadas.

## Red, TLS y proxy

Traefik redirige HTTP a HTTPS, obtiene certificados ACME y enruta `/api/` y `/socket.io` al backend. Su configuración dinámica resuelve `NEXUS_HOST` desde el entorno. No publica dashboard administrativo ni monta `/var/run/docker.sock`.

`trustProxy` está deshabilitado para no aceptar IPs falsificadas por cabeceras. Por tanto el límite por IP detrás de Traefik se aplica a la IP del proxy y las excepciones de mantenimiento ven esa misma dirección. Para utilizar IP del cliente se requiere configurar una lista explícita de proxies confiables y probar que el backend no es accesible directamente; no basta con cambiarlo a `true` indiscriminadamente.

Proxmox, vCenter y Kubernetes necesitan salida desde el backend hacia sus endpoints HTTPS. Los webhooks requieren salida a los orígenes autorizados. En un despliegue con firewall, permite únicamente esos destinos. El servidor DNS y la allowlist son configuración administrativa de confianza.

## Helm

El chart no instala bases de datos. Aprovisiona PostgreSQL 16 y Redis 7 con persistencia/HA, inicializa el esquema y añade su conexión al Secret existente. Construye imágenes desde los Dockerfiles, publícalas en el registry de tu organización y configura `image.backend` e `image.frontend`.

Puedes generar una vista de manifests sin desplegar:

```bash
helm template nexus helm/m4m0-nexus -f helm/m4m0-nexus/values.production.yaml
```

El Secret existente requiere `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`. El chart incluye CORS/orígenes de webhooks en ConfigMap. `imagePullSecrets` permite registries privados.

El certificado del Ingress debe existir en `ingress.tlsSecret`, o provisionarse mediante anotaciones compatibles con cert-manager. El chart usa TLS, pero la política de redirección HTTP/HTTPS depende del Ingress controller.

Para la cuenta bootstrap, utiliza un Job temporal con la misma imagen y variables `ADMIN_EMAIL`/`ADMIN_PASSWORD`, comando `node backend/dist/seed.js`. Retira ese Job y su secreto temporal cuando termine. En Helm el bootstrap sigue siendo un Job gestionado por el operador; en Compose se incluye el servicio de inicialización automáticamente.

### Escalado

Por defecto solo hay un backend. HPA se proporciona como plantilla opt-in. Para usar varias réplicas, añade adapter Redis a Socket.io y afinidad de sesiones del Ingress, almacenamiento RWX o S3 para backups, límites globales de jobs y una política de sincronización. El chart no convierte estas dependencias en HA automáticamente. No actives HPA con el PVC RWO por defecto.

## Logs y salud

- `/health/live`: proceso HTTP activo.
- `/health/ready`: PostgreSQL y Redis responden.
- Pino: logs estructurados sin cuerpos, contraseñas ni cabeceras de autorización/cookie.
- `audit_logs`: mutaciones HTTP, solicitudes/resultados de VM, sesiones y hooks de plugin.
- `webhook_logs`: estado HTTP, intento, latencia y error resumido; no se guardan respuestas completas del receptor.
- `backup_history`: ejecución, resultado, tamaño y duración.

Los handlers de SIGTERM/SIGINT cierran workers, conexiones y servidor. Los jobs de backup no deben ejecutarse con reintentos automáticos ciegos sobre hipervisores.

## Parada local

Detén las terminales de Vite y API con Ctrl+C. Detén los servicios con:

```bash
docker compose -f docker-compose.dev.yml down
```

Los volúmenes se conservan. Las pruebas usan `nexus_test` separada de `nexus` y pueden conservar fixtures para inspección.
