# Copias y recuperación

## Configuración

Ejemplo de job de configuración, enviado a `POST /api/v1/backups/jobs`:

```json
{
  "name": "Configuración diaria",
  "type": "full",
  "targets": [],
  "schedule": "0 2 * * *",
  "retention": 30,
  "storage": { "type": "local" },
  "compression": true,
  "encryption": true,
  "encryptionPassword": "una-contrasena-larga-de-backup",
  "active": true
}
```

Para S3, `storage` admite `bucket`, `endpoint`, `region`, `accessKey`, `secretKey`. Sin claves explícitas el SDK puede usar la cadena de credenciales del entorno, adecuada para roles de carga de trabajo. Las credenciales configuradas se cifran en PostgreSQL. El historial conserva la configuración cifrada del destino usado para que un cambio posterior del job no rompa la descarga.

NFS y SMB se usan como volúmenes montados por Docker/Kubernetes en `/data/backups`. NEXUS no monta shares ni recibe contraseñas de montaje. La retención por días elimina los archivos de configuración vencidos y sus registros. No hay política GFS todavía.

La exportación JSON tiene un payload versionado y SHA-256. Con cifrado, scrypt deriva una clave de 256 bits con sal aleatoria, y AES-GCM autentica el contenido. Sin cifrado, el checksum detecta corrupción accidental, no demuestra autenticidad frente a un atacante que modifique el archivo.

## VMs Proxmox

```json
{
  "name": "VMs producción",
  "type": "vm",
  "targets": ["UUID-DE-LA-VM-EN-NEXUS"],
  "schedule": "0 3 * * *",
  "retention": 30,
  "storage": { "type": "local", "proxmoxStorage": "backup-nfs" },
  "compression": true,
  "encryption": false
}
```

El job invoca `vzdump` con modo `snapshot` y `zstd` y espera el resultado de la tarea Proxmox. `storage.proxmoxStorage` es el ID del storage configurado **en Proxmox**; no es el directorio de NEXUS. La retención de esas copias y su cifrado dependen de la configuración del hipervisor o de Proxmox Backup Server.

NEXUS no valida que haya ocurrido un freeze del filesystem del invitado. Instala guest agent y configura consistencia dentro del hipervisor; comprueba el log de vzdump. No se promete consistencia de aplicación sin esa validación.

Los archivos VM no se descargan ni restauran desde NEXUS 0.1.0. Usa el catálogo/restore de Proxmox. El historial distingue estas ejecuciones y no ofrece un archivo de configuración como si fuese una copia de discos.

## Restaurar configuración

1. Conserva copia segura de `ENCRYPTION_KEY`, además del archivo y su contraseña.
2. Arranca PostgreSQL con el esquema de la versión correspondiente.
3. Configura la clave maestra del origen en el entorno de destino.
4. Entra como administrador local.
5. Usa **Exportar / importar**, selecciona el JSON NEXUS y su contraseña.
6. Comprueba el resultado. Vuelve a sincronizar las infraestructuras importadas.

Se valida el esquema antes de escribir, se descifran los blobs para verificar que la clave coincide y se abre una transacción. Una colisión no tolerada, una referencia inexistente o una inserción fallida revierte todas las inserciones de esa importación. El modo es `merge-missing`: IDs existentes se conservan; un email/nombre ya existente con otro ID produce conflicto y rollback. El límite es 20 MB.

Los refresh tokens nunca se exportan. Los API tokens solo se exportan por selección explícita y siguen siendo hashes. La auditoría local no se reescribe. Las exportaciones SQL son para uso supervisado con PostgreSQL en un entorno aislado; la API no ejecuta SQL importado.

## Recuperación completa

Las exportaciones de NEXUS no reemplazan las copias físicas/lógicas de PostgreSQL, el AOF de Redis, los certificados ni las copias de discos de los hipervisores. Para recuperación del servicio conserva también esas dependencias, los manifests/variables de despliegue y la clave maestra. Prueba la recuperación en un entorno aislado y mide RPO/RTO; el repositorio no presupone objetivos de recuperación cumplidos.
