# Terraform provider m4m0nexus

Provider Go con Terraform Plugin SDK v2. No está publicado en Registry. El identificador `m4m0/m4m0nexus` de los ejemplos representa el destino previsto, no una publicación existente.

## Compilar y probar

```bash
go mod download
go test ./...
go vet ./...
go build -o terraform-provider-m4m0nexus
```

Configura un override de desarrollo en tu archivo CLI de Terraform:

```hcl
provider_installation {
  dev_overrides {
    "m4m0/m4m0nexus" = "/ruta/absoluta/al/terraform-provider"
  }
  direct {}
}
```

Usa el provider compilado mediante `terraform plan/apply` con ese override. Un `terraform init` normal puede intentar resolver Registry; no presupongas que el namespace existe. Para distribución interna utiliza un filesystem/network mirror de Terraform con el layout oficial de providers.

El cliente requiere HTTPS, verifica TLS con el sistema y rechaza redirecciones para no reenviar credenciales. `NEXUS_ENDPOINT` y `NEXUS_API_TOKEN` pueden proporcionar configuración. Instala tu CA corporativa en el trust store de la máquina que ejecuta Terraform.

## Recursos

| Recurso | Operaciones | Observaciones |
| --- | --- | --- |
| `m4m0nexus_infrastructure` | Create/read/update/delete/import | No conecta ni sincroniza al crear; ejecuta sync en NEXUS. Proveedor inmutable en backend. |
| `m4m0nexus_vm` | Create/read/delete/import | Clona plantilla QEMU Proxmox; dimensionamiento/plantilla requieren reemplazo. |
| `m4m0nexus_webhook` | CRUD/import | Destino debe estar en allowlist del servidor. |
| `m4m0nexus_user` | CRUD/import | No permite borrar al usuario que ejecuta la petición; protege tu cuenta de servicio. |
| `m4m0nexus_api_token` | Create/read/delete/import | Campos requieren reemplazo para rotación; valor secreto solo al crear. |

La API guarda los tokens por hash, por lo que un token importado no puede recuperar su valor original. Un recurso VM importado requiere completar en configuración los campos de plantilla y disco que no se pueden reconstruir desde el inventario normalizado.

Los atributos `Sensitive` se ocultan en la salida, **pero permanecen en el state de Terraform**. Usa backend cifrado y acceso restringido al state. No comitees `terraform.tfstate` ni variables secretas.

Scopes típicos de una cuenta de automatización admin: `infra:read`, `infra:write`, `vms:read`, `vms:write`, `webhooks:read`, `webhooks:write`, `users:read`, `users:write`, `tokens:read`, `tokens:write`. Reduce la lista a los recursos gestionados. Los tokens hijos no pueden tener scopes ni caducidad superiores a su padre.

`examples/main.tf` usa placeholders y no debe ejecutarse sin sustituir endpoints y revisar el plan. El nombre de una plantilla del ejemplo original (`ubuntu-22.04`) se expresa en esta implementación como ID externo Proxmox `nodo/qemu/9000`.

## Pruebas y publicación

Las pruebas verifican el esquema del provider, autenticación HTTP, rechazo de HTTP no cifrado y prevención de reenvío en redirecciones mediante servidores TLS locales. No son acceptance tests contra un hipervisor. El workflow de release construye binarios para Linux/macOS en amd64/arm64 y los deja como artefactos; no firma ni publica releases o paquetes.

Para publicar en Registry se necesitan repositorio público o registry privado, metadata del provider, checksum/firmas, releases y control del namespace. Ese proceso no se ejecutó en esta tarea.
