# Validación realizada

Actualizado: 12 de septiembre de 2026. Entorno local macOS, Node.js 22.22.0 y Docker Desktop. Se verificó el código del workspace, sin acceso a servidores de producción.

| Verificación                                                      | Resultado                                                                                                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript estricto backend/frontend y build Vite                 | Correcto                                                                                                                                                         |
| Suite Node.js con PostgreSQL 16 y Redis 7 reales                  | 26 pruebas aprobadas, 0 fallos                                                                                                                                   |
| Pruebas de conectores                                             | Normalización Proxmox, UPID, rechazo de traversal, kubeconfig sin ejecución de comandos                                                                          |
| Pruebas de seguridad/API                                          | Login, rotación y reutilización de refresh, RBAC, revocación, cifrado, allowlist, mantenimiento, rollback e inmutabilidad de auditoría para el rol de aplicación |
| Plugins                                                           | Carga real del ejemplo, hook permitido/rechazado y logs de ejecución                                                                                             |
| npm audit                                                         | 0 vulnerabilidades reportadas el 10/09 para el lockfile instalado; sin cambios de dependencias en esta actualización                                             |
| Docker build backend/frontend                                     | Ambas imágenes construidas correctamente                                                                                                                         |
| Ejecución de imágenes con raíz de solo lectura y sin capabilities | Frontend `/health` y backend `/health/ready` responden correctamente; contenedores de smoke retirados al terminar                                                |
| Docker Compose                                                    | Stacks de desarrollo y aplicación completa operativos; bootstrap, login, refresh, identidad RBAC y Socket.io por proxy verificados                               |
| Terraform provider                                                | `go test ./...`, `go vet ./...` y `go build` correctos, usando Go 1.24 en Docker                                                                                 |
| Helm 3.18.6                                                       | `helm lint`: 1 chart aprobado; render con valores de producción correcto                                                                                         |
| Formato                                                           | Prettier check correcto                                                                                                                                          |
| Preview local                                                     | HTTP 200 en 127.0.0.1:5173; API ready en 127.0.0.1:3001                                                                                                          |

Una prueba detectó que el segmento de nodo de un ID Proxmox admitía `..`. Se corrigió el validador para exigir un primer carácter alfanumérico y se comprobó que la petición no se despacha al transporte.

La prueba del stack completo detectó un conflicto entre los listeners de upgrade de Socket.io y las consolas WebSocket. Se separó el encaminamiento de ambos protocolos y se comprobó una conexión Socket.io real a través de Nginx. Esta comprobación queda incluida en CI mediante `scripts/test-compose.mjs`.

Las pruebas de integración usan una base independiente `nexus_test`, separada de `nexus`. Los secretos fueron generados aleatoriamente en `.env` local y no se incluyen en el archivo de código fuente.

## Docker y Zerobyte

- Contratos mediante HTTPS real de prueba: mTLS Docker, negociación de API, rechazo de traversal/redirecciones, filtrado de secretos, logs TTY/multiplexados y conservación de retención/reintentos al editar Zerobyte.
- API NEXUS con PostgreSQL/Redis reales: altas de conexiones, cifrado, respuestas sin secretos, cambio de endpoint con credenciales nuevas, roles/scopes y exportación de conexiones.
- Docker Engine local: creación de volumen y contenedor aislados, inventario, arranque, parada, logs y eliminación sin borrar otros recursos. Se normalizó la respuesta `Ports: null` detectada en esta prueba.
- Imagen oficial `ghcr.io/nicotsx/zerobyte:v0.42.0`: API key, origen y repositorio, creación/edición/ejecución de trabajo, backup Restic completado de un volumen Docker, consulta de snapshots/historial y restauración a `/restore`. El contenido restaurado coincide con el original.
- Compose: migración de la base existente, servicios sanos y prueba de frontend, bootstrap, login, refresh y WebSocket. El stack independiente de Zerobyte valida con `docker compose config --quiet`.

La prueba de proveedores reales es reproducible con `npm run build` y `node scripts/test-container-providers.mjs`. Usa nombres aleatorios y limpia exclusivamente sus contenedores, volumen y certificados temporales. Está incluida en CI. No valida consistencia de bases de datos activas ni accede a hosts Docker de producción.

## No verificado

- Autenticación/operaciones contra Proxmox, XAPI, vCenter o Kubernetes reales.
- LDAP real, S3 real, entrega de webhooks a receptores externos o consolas de hipervisores.
- Certificado ACME de un dominio real o despliegue Helm en un cluster.
- Acceptance tests Terraform contra infraestructura real ni publicación en Registry.
- E2E completas de navegador, revisión visual automatizada, benchmark, carga o pentest. Se revisaron manualmente en el navegador las pantallas Docker/Zerobyte y el formulario de conexión con una cuenta temporal, eliminada al terminar.

Estos límites importan: una compilación correcta y pruebas locales no convierten la plataforma en un producto enterprise terminado. El estado exacto de cada función figura en [CAPABILITIES.md](CAPABILITIES.md).
