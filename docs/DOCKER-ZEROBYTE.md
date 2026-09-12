# Docker y backups con Zerobyte

NEXUS gestiona varios Docker Engine mediante su API HTTPS con TLS mutuo. Zerobyte ejecuta las copias de los datos persistentes, conserva sus snapshots Restic y aplica programación y retención. La integración usa la API v1 de **Zerobyte v0.42.0** (`x-api-key`), verificada contra su código etiquetado; las versiones futuras pueden cambiar el contrato.

## Actualizar NEXUS

```bash
git pull --ff-only
./scripts/deploy.sh local
# En producción: ./scripts/deploy.sh production
```

Compose ejecuta el servicio temporal `migrate` antes del bootstrap y del backend. Aplica las tablas nuevas sin borrar datos. No utilices `down -v`. Las conexiones Docker/Zerobyte también se incluyen al exportar infraestructuras en NEXUS; sus credenciales siguen vinculadas a `ENCRYPTION_KEY`.

En desarrollo, aplica `database/init-scripts/003_docker_zerobyte.sql` a `nexus` con el propietario de la base antes de arrancar la API. La suite de integración aplica esta migración a `nexus_test` automáticamente.

## Conectar Docker

1. Configura Docker Engine 27+ (API 1.47+) con `tlsverify`, CA, certificado y clave del servidor. Sigue la [guía oficial de TLS de Docker](https://docs.docker.com/engine/security/protect-access/).
2. Permite el puerto 2376 únicamente desde NEXUS en tu red de administración. El hostname del endpoint debe coincidir con el certificado.
3. En **Docker → Añadir host**, introduce nombre, endpoint `https://docker.example.com:2376`, CA, certificado y clave de cliente PEM.
4. Consulta contenedores, proyectos/servicios Compose, puertos, mounts, imágenes, volúmenes y redes. Los inventarios son consultas reales, sin copiar contenedores a la lista de VM.

Los administradores pueden crear contenedores detenidos desde imágenes locales, publicar puertos TCP, asociar volúmenes existentes, crear volúmenes, arrancar, detener, reiniciar, pausar, reanudar y eliminar contenedores detenidos. El borrado no fuerza la parada ni elimina volúmenes. Los logs devuelven como máximo 2.000 líneas y 8 MB; interpretan tanto TTY como stdout/stderr multiplexado.

Los roles `user` y `readonly` pueden consultar inventario con `docker:read`. Las operaciones `docker:write` y los logs `docker:logs` requieren administrador y el scope correspondiente si se usa API token. Los certificados se guardan cifrados y no se devuelven en las respuestas. Un cambio de endpoint exige credenciales nuevas.

No se monta el socket Docker en el backend. No se implementan todavía SSH, terminal exec, pull de imágenes privadas, editor/despliegue remoto de YAML Compose, Swarm, ni borrado de imágenes/volúmenes/redes. La agrupación Compose permite consultar los contenedores de un proyecto.

## Desplegar Zerobyte con Compose

Puedes conectar una instancia existente v0.42.0 o utilizar [el stack independiente](../examples/zerobyte/docker-compose.yml) en el host Docker que contiene los datos:

```bash
cd examples/zerobyte
cp .env.example .env
openssl rand -hex 32
# Guarda el resultado en ZEROBYTE_APP_SECRET y configura el resto de .env.
docker compose up -d
```

Configura `ZEROBYTE_HOST` en tu DNS privado y `DOCKER_BACKUP_SOURCE` como el directorio de datos que quieres proteger. El ejemplo publica HTTPS en loopback; para acceso desde otro servidor, define `ZEROBYTE_BIND_IP` con la IP privada del host y permite exclusivamente tu red de administración. Usa un host/puerto distinto del proxy de NEXUS si están en la misma máquina.

El proxy Caddy genera una CA interna. Expórtala con:

```bash
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./zerobyte-ca.crt
```

Confía en esa CA en tu navegador y pégala en el campo CA de NEXUS. El hostname debe resolver también desde el contenedor backend de NEXUS. No se deshabilita la validación TLS.

1. Abre Zerobyte y completa su alta de administrador; conserva su recovery key y `APP_SECRET`.
2. Crea un origen **Directory** que apunte a `/sources/docker`.
3. Configura un repositorio de destino en Zerobyte (por ejemplo S3 o un disco separado). El estado y repositorios locales de Zerobyte persisten en `zerobyte_data`; considera un destino externo para sobrevivir a la pérdida del host.
4. Genera una API key en la configuración de Zerobyte.
5. En **Backups Docker → Conectar Zerobyte**, registra su URL HTTPS, API key, CA y el host Docker al que corresponde.
6. Pulsa **Actualizar** y crea un trabajo seleccionando origen, repositorio, cron, retención y rutas. Las programaciones usan la zona horaria de Zerobyte, no la del navegador ni la de NEXUS.
7. Ejecuta una copia y consulta su estado e historial. HTTP 202 significa tarea iniciada, no copia terminada. Consulta snapshots por repositorio. **Abrir Zerobyte / restaurar** lleva a la interfaz que permite elegir snapshot y rutas de restauración.

El ejemplo usa únicamente directorios ya montados y no necesita `SYS_ADMIN` ni FUSE. Para volúmenes Docker con nombre, monta cada volumen externo explícitamente en Zerobyte, por ejemplo:

```yaml
services:
  zerobyte:
    volumes:
      - application_data:/sources/application:ro
volumes:
  application_data:
    external: true
    name: nombre_real_del_volumen
```

Crea el origen correspondiente a `/sources/application` en Zerobyte. El enlace con un host en NEXUS es organizativo: no monta automáticamente sus volúmenes ni comprueba que el directorio seleccionado contenga los datos esperados. NEXUS muestra todos los trabajos de la organización de la API key; usa una instancia/organización coherente con el host asociado.

## Consistencia y recuperación

Una copia de archivos de un volumen activo no garantiza consistencia de PostgreSQL, MySQL u otras bases de datos. Prepara volcados nativos consistentes o coordina la pausa de escritura mediante los mecanismos del servicio y Zerobyte antes de copiar. NEXUS no detiene contenedores automáticamente al iniciar un backup ni promete backups consistentes de bases de datos activas.

Conserva también los archivos Compose y la configuración necesaria para recrear los servicios. Los snapshots protegen los datos seleccionados; no incluyen automáticamente imágenes, secretos externos ni toda la definición de Docker. El ejemplo incorpora un volumen de recuperación escribible en `/restore`, separado de los orígenes de solo lectura. Para restaurar, elige `/restore` como ruta de recuperación en Zerobyte, verifica el contenido y recrea/arranca el servicio con sus volúmenes restaurados. La restauración de datos se realiza en Zerobyte, no mediante un botón de restauración de configuración de NEXUS.

## Fuentes de los contratos

- [Docker Engine API](https://docs.docker.com/reference/api/engine/version/v1.47/).
- [Zerobyte v0.42.0](https://github.com/nicotsx/zerobyte/tree/v0.42.0), commit `b87c59b1fd53cb35c4e192dc20f29b1d2ff309a8`.
- [API de backups](https://github.com/nicotsx/zerobyte/blob/v0.42.0/app/server/modules/backups/backups.controller.ts), [autenticación](https://github.com/nicotsx/zerobyte/blob/v0.42.0/app/server/modules/auth/auth.middleware.ts), [snapshots](https://github.com/nicotsx/zerobyte/blob/v0.42.0/app/server/modules/repositories/repositories.dto.ts).

Zerobyte se ejecuta como servicio externo con su propia imagen y licencia; no se incorpora su código al backend de NEXUS.
