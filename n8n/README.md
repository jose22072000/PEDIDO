# Ingesta de pedidos desde Google Drive (n8n) — robusto y multi-sucursal

Reemplaza el workflow viejo (`Automatizar Pedidos SUCURSALES`) que perdía archivos.
La app que genera los pedidos NO es nuestra: exporta CSVs a carpetas de Google Drive.
n8n los levanta y los mete a PEDIDO por `POST /orders/bulk`.

- n8n vivo: http://72.60.115.124:5678
- Workflow creado: **`pFS1xKCyJNCRMsKs`** — *Ingesta Pedidos (multi-sucursal) — cuenta padre 1*
- JSON versionado: [`ingesta-pedidos-multisucursal.json`](./ingesta-pedidos-multisucursal.json)

## Modelo

**1 workflow por CUENTA PADRE de Google.** Cada cuenta padre comparte hasta **4 sucursales**
(límite de Google). Un workflow = 1 credencial de Google = hasta 4 carpetas.
Cuenta padre nueva → duplicar el workflow, nueva credencial de Google, editar el Config.

## Grafo

```
Cada minuto (Schedule)
 → Config sucursales (Code)   // lista editable de {inbox, proc, err} x4
 → Buscar CSVs (Drive search) // corre 1 vez por sucursal; pide el campo `parents`
 → Mapear carpeta (Code)      // empareja cada archivo con su Procesados/Errores por parents[0]
 → Por archivo (loop batch 1) // AISLAMIENTO: un archivo malo no tumba a los demas
    → Descargar → Leer CSV ──(parse falla)──┐
                     │                        │
                     → Enviar a PEDIDO ?sync=1 ─(4xx/red)─┤
                          │ (2xx)                          │
                          → Mover a Procesados             → Mover a Errores
```

## Por qué ya NO se rompe (los 3 bugs del viejo)

| Bug viejo | Causa | Fix |
|---|---|---|
| Empieza por el nuevo y **nunca vuelve a subir los de atrás** | Trigger `fileCreated`: solo dispara para archivos nuevos; un rezagado ya no es "nuevo" | `Schedule + Search` **re-lista** el inbox cada minuto → los rezagados siempre se reintentan. Mover-a-Procesados = marca de hecho |
| **Formato distinto mata todo** | Un item malo tumbaba la ejecución entera | `Por archivo` (batch 1) + salidas de error → ese archivo va a Errores, el resto sigue |
| Cae Starlink → **"no encuentra archivo"** | Fallo de red perdía el item | `retryOnFail` en los nodos de Drive + el próximo Schedule reintenta. Import **idempotente** (upsert por folio+vendedor+cliente) → reprocesar es seguro |

## Config (nodo "Config sucursales")

Editar SOLO la lista `SUCURSALES`. Pegar los IDs de carpeta de Drive:

```js
{ sucursal: 'Guantanamo', inbox: '<ID carpeta PEDIDOS>', proc: '<ID Procesados>', err: '<ID Errores>' }
```

Las filas con `PEGAR_...` se ignoran hasta llenarlas. Guantánamo ya viene con IDs reales.
El **ID de carpeta** sale de la URL de Drive: `drive.google.com/drive/folders/<ESTE_ID>`.

## Para dejarlo andando

1. **Credencial de Google** (manual, en la UI): asignarla a los 4 nodos de Drive
   (`Buscar CSVs`, `Descargar`, `Mover a Procesados`, `Mover a Errores`).
2. **Config sucursales**: pegar inbox/proc/err de las otras 3 sucursales de esta cuenta padre.
3. **Move nodes** (`driveId`): vienen en `My Drive`. Si las carpetas están en una **Unidad
   compartida**, cambiar `driveId` a esa unidad.
4. Activar el workflow. Desactivar el viejo (`Automatizar Pedidos SUCURSALES`).

## Visibilidad (ver quién falló)

Cada ejecución en n8n muestra, por archivo: entró (→ Procesados) o falló (→ Errores).
El fallo autoritativo (ej. colisión de vendedor → 409) requiere el flag `?sync=1` en la
API, que hace el import **inline** y devuelve el resultado real en la misma respuesta.

> **Deployado y verificado** (commit `db52584`): `?sync=1` → 200 inline con el `results`
> real; sin el flag → 202 (encolado), idéntico a antes. La UI no cambió.
