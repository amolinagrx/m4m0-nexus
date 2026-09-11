# Validación realizada

Fecha: 11 de septiembre de 2026. Entorno local macOS, Node.js 22.22.0 y Docker Desktop. Se verificó el código del workspace, sin acceso a servidores de producción.

| Verificación                                                      | Resultado                                                                                                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript estricto backend/frontend y build Vite                 | Correcto                                                                                                                                                         |
| Suite Node.js con PostgreSQL 16 y Redis 7 reales                  | 21 pruebas aprobadas, 0 fallos                                                                                                                                   |
| Pruebas de conectores                                             | Normalización Proxmox, UPID, rechazo de traversal, kubeconfig sin ejecución de comandos                                                                          |
| Pruebas de seguridad/API                                          | Login, rotación y reutilización de refresh, RBAC, revocación, cifrado, allowlist, mantenimiento, rollback e inmutabilidad de auditoría para el rol de aplicación |
| Plugins                                                           | Carga real del ejemplo, hook permitido/rechazado y logs de ejecución                                                                                             |
| npm audit                                                         | 0 vulnerabilidades reportadas para el lockfile instalado                                                                                                         |
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

## No verificado

- Autenticación/operaciones contra Proxmox, XAPI, vCenter o Kubernetes reales.
- LDAP real, S3 real, entrega de webhooks a receptores externos o consolas de hipervisores.
- Certificado ACME de un dominio real o despliegue Helm en un cluster.
- Acceptance tests Terraform contra infraestructura real ni publicación en Registry.
- Pruebas E2E de navegador, revisión visual automatizada, benchmark, carga o pentest.

Estos límites importan: una compilación correcta y pruebas locales no convierten la plataforma en un producto enterprise terminado. El estado exacto de cada función figura en [CAPABILITIES.md](CAPABILITIES.md).
