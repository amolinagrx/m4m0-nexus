# Modelo de seguridad

## Fronteras de confianza

NEXUS es una plataforma de administración: sus usuarios con permisos de escritura pueden apagar, borrar o ejecutar comandos sobre infraestructura. Los endpoints y CAs los configuran administradores. Un cluster Kubernetes o un hipervisor conectado debe considerarse un sistema externo de confianza limitada.

Los usuarios `admin`, `user` y `readonly` comparten el inventario. La autorización es por tipo de recurso/operación, no por tenant, proyecto, carpeta ni VM individual. No utilices esta versión como frontera multi-tenant.

## Controles implementados

- Argon2id para passwords, tokens aleatorios de 256 bits, SHA-256 para tokens persistidos.
- JWT de 15 minutos con issuer/audience, refresh de siete días, rotación transaccional y revocación familiar ante reutilización.
- Cookies HttpOnly, SameSite=Strict y Secure en producción. Refresh/logout verifican el origen exacto.
- Consultas parametrizadas, validación Zod, listas permitidas de tablas/columnas para importación.
- Rol PostgreSQL de aplicación sin propiedad ni superusuario. Auditoría con trigger que rechaza UPDATE/DELETE/TRUNCATE y privilegios restringidos.
- Cifrado autenticado AES-256-GCM con nonce aleatorio; backups con clave derivada y sal aleatoria.
- TLS verificado hacia proveedores y LDAP. Kubeconfig no puede invocar plugins ejecutables ni leer archivos locales del servidor.
- Webhooks con allowlist exacta HTTPS, redirecciones rechazadas, HMAC y timeout. Configura adicionalmente firewall/egress para no confiar solo en DNS.
- Rate limit Redis por IP y 300 peticiones/minuto por API token. El límite de IP es compartido detrás del proxy mientras `trustProxy=false`.
- Tickets WebSocket ligados a usuario y recurso, consumidos atómicamente en Redis, 30 segundos para iniciar, sesión máxima de 15 minutos y controles de flujo.
- Consolas y exec comprueban permisos/origen/mantenimiento y revalidan durante la sesión. El acceso de lectura a logs también requiere permisos.
- Secretos omitidos de respuestas de inventario y logs. Variables reales no se incluyen en imágenes ni Git.

## Límites

Los plugins solo están aislados en procesos para contener bloqueos/memoria, no en un sandbox de seguridad. Pueden acceder a recursos que permita la cuenta del sistema. Únicamente instala código revisado. Los settings de plugins son JSON administrativo; no deben almacenar credenciales sensibles. El marketplace y el aislamiento para módulos hostiles están pendientes.

La auditoría es append-only para la cuenta de aplicación. Un superusuario o administrador del almacenamiento puede alterarla: para exigencias regulatorias replica eventos hacia un almacén externo WORM/SIEM. No se anuncia inmutabilidad frente al propietario del sistema.

La API no implementa MFA, aislamiento multi-tenant, outbox transaccional ni tareas durables para todas las mutaciones de hipervisores. Un fallo de red después de una mutación puede dejar la operación completada externamente y una respuesta de error local. Consulta el proveedor antes de reintentar.

La allowlist de webhooks autoriza orígenes administrativamente; no implementa pinning DNS. Usa controles de egress. Proxmox/XAPI/vCenter tienen permisos propios que deben limitarse además del RBAC NEXUS.

Los certificados de cliente y CAs pueden necesitar rotación manual. No hay keyring ni rotación automática de ENCRYPTION_KEY. Perder esa clave implica perder acceso a las credenciales cifradas.

## Reportar problemas

No añadas secretos, dumps de producción ni tickets VNC a issues o logs. Envía al equipo propietario del despliegue una descripción reproducible y saneada del problema. Este repositorio no afirma contar con un programa público de divulgación de vulnerabilidades.
