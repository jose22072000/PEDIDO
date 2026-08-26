# Integración delivery-apk → PEDIDO

**Para:** Amado (delivery-apk)
**De:** PEDIDO
**Fecha:** 26 de agosto de 2026

## Qué cambia respecto a lo que estaba previsto

En el `integration.md` de delivery-apk el flujo era de ida y vuelta: PEDIDO hacía un
`POST` por cada pedido que pide domicilio, y delivery-apk devolvía el costo.

**La ida se elimina.** En delivery-apk el repartidor teclea el número de pedido a mano
(`nueva-entrega.tsx`, campo «Número de pedido») y elige al cliente de la lista que
delivery-apk ya tiene sincronizada desde `/api/integration/clients`. Cuando llega el
pedido, delivery-apk ya lo tiene delante: que PEDIDO se lo anunciara era contarle algo
que ya sabía.

Queda **un solo webhook**, y va en un solo sentido:

```
delivery-apk  ──POST firmado──▶  PEDIDO
              ◀──respuesta detallada──
```

## El endpoint

```
POST https://pedidos.procovar.cloud/api/webhooks/domicilio
Content-Type:        application/json
X-Webhook-Key:       apk-domicilio-d0d04fd3bbde
X-Webhook-Signature: sha256=<HMAC-SHA256 hex del cuerpo CRUDO>
```

La firma es `'sha256=' + hmac_sha256_hex(secret, cuerpo_crudo)`. Se firma el **cuerpo
exacto que se envía**, byte por byte — no una reserialización del objeto. Dos
serializaciones del mismo JSON pueden diferir en el orden de las claves o en un espacio,
y entonces la firma no cuadra nunca por un motivo que no se ve en ningún log.

El secret es el mismo en los dos lados. En PEDIDO se configura en
**Configuración → Webhook Domicilio (APK)**.

## Qué manda delivery-apk

```json
{
  "entregas": [
    {
      "folio": "PAP25-4821",
      "costo": 14.44,
      "tasa": 415,
      "distanciaKm": 3.2,
      "distanciaDesde": "almacen:HAB",
      "latitud": 23.1085,
      "longitud": -82.3421,
      "direccion": "Calle 23 #456 e/ 4 y 6, Vedado"
    }
  ]
}
```

Hasta 500 entregas por llamada. Una sola también vale sin envolver en `entregas`.

### Los campos

| Campo | Obligatorio | Qué es |
|---|---|---|
| `folio` | sí* | El número de pedido que tecleó el repartidor. `pedidoId` vale igual y es más seguro si lo tiene. |
| `costo` | sí | El costo del domicilio **en USD**. Se rechaza si no es un número o si es negativo. |
| `tasa` | no | La tasa CUP/USD con la que delivery-apk calculó ese costo. |
| `distanciaKm` | no | Distancia medida. Se guarda **en el cliente**, no en el pedido. |
| `distanciaDesde` | no | Desde dónde se midió, p. ej. `almacen:HAB`. |
| `latitud` / `longitud` | no | Dónde está el cliente de verdad. |
| `direccion` | no | La dirección tal como la encontró el repartidor. |

\* `folio` o `pedidoId`: hace falta uno de los dos.

### Por qué la tasa y no el importe en CUP

El costo viaja en USD y PEDIDO guarda **la tasa** con la que se cotizó, no un segundo
importe en pesos. Con dos importes hay dos verdades que se separan en cuanto cambie la
tasa, y ninguna forma de saber cuál es la buena. Con la tasa, el CUP se reproduce exacto
—el mismo que vio quien cobró— y queda constancia de a cómo estaba el cambio ese día.

### La ubicación: delivery-apk puede corregirla

Si delivery-apk manda `latitud`/`longitud`, PEDIDO **pisa lo que tuviera**, aunque ya
hubiera coordenadas del consolidado de Parranda. El repartidor está parado en la puerta:
si dice que el cliente no está donde dice el consolidado, el equivocado es el
consolidado.

PEDIDO guarda el valor anterior antes de cambiarlo, así que una corrección equivocada se
puede deshacer. Y si el cliente se movió, borra la distancia guardada: se midió a un
sitio donde ya no está.

Dos coordenadas se descartan sin dar error: las que caen **fuera de Cuba** (latitud
19–24, longitud −85 a −73). Un dígito de más pone al cliente en otro continente y el
domicilio se cobraría por miles de kilómetros.

## Qué contesta PEDIDO

La respuesta dice **qué se guardó de cada entrega**, no sólo que se aceptó. Cada campo
entra por su cuenta y cualquiera puede descartarse solo — una tasa en cero, una
coordenada fuera de Cuba, una ubicación idéntica a la que ya había. Con un «ok» pelado,
delivery-apk daría por guardado algo que no lo está.

```json
{
  "ok": true,
  "recibidas": 2,
  "aplicadas": [
    {
      "folio": "PAP25-4821",
      "pedidoId": "clx...",
      "guardado": ["costo", "tasa", "distancia", "ubicacionCliente"]
    },
    {
      "folio": "PAP25-4822",
      "pedidoId": "cly...",
      "guardado": ["costo"]
    }
  ],
  "rechazadas": []
}
```

Los valores posibles de `guardado`: `costo`, `tasa`, `distancia`, `ubicacionCliente`,
`direccionCliente`.

**Un campo que no aparece en `guardado` no se guardó.** Si delivery-apk mandó `tasa` y no
vuelve en la lista, esa tasa se descartó. Si mandó coordenadas y no aparece
`ubicacionCliente`, o eran las mismas que ya había o caían fuera de Cuba.

### Las rechazadas

```json
{
  "ok": false,
  "recibidas": 3,
  "aplicadas": [ ... ],
  "rechazadas": [
    { "folio": "PAP25-9999", "motivo": "folio no encontrado" },
    { "folio": "PAP25-1234", "motivo": "folio repetido en esta sucursal: manda pedidoId o vendedorCodigo" }
  ]
}
```

Un lote con algunas malas **no tumba las buenas**: PEDIDO devuelve 200, guarda las que
puede y detalla las que no. Que una entrega venga mal no es razón para descartar las
otras veinte que venían bien.

### Los errores

| Código | Qué pasó | ¿Reintentar? |
|---|---|---|
| `401` | Firma inválida, o `X-Webhook-Key` no coincide | No. Revisar el secret. |
| `503` | El webhook no está configurado o está desactivado en PEDIDO | Sí, más tarde. |
| `400` | Cuerpo vacío, o no vino ninguna entrega | No. |
| `413` | Más de 500 entregas en una llamada | No. Partir el lote. |

## Idempotencia

Mandar dos veces lo mismo deja lo mismo. PEDIDO resuelve por folio y sobrescribe: es lo
que permite a delivery-apk reintentar sin pensarlo cuando no sabe si la primera llegó.

## Probar antes de mandar nada

```
POST https://pedidos.procovar.cloud/api/webhooks/ping
```

Con las mismas cabeceras. No toca ningún pedido. **Es lo primero que hay que hacer al
configurar:** si el ping no devuelve `ok`, el problema es de firma o de secret, no de
datos — y averiguarlo con pedidos de verdad por medio cuesta mucho más.

## Lo que delivery-apk sigue jalando de PEDIDO

Esto no cambia:

- `GET /api/integration/clients?sucursalCodigo=HAB` — los clientes, con coordenadas,
  dirección, municipio, vendedor y la distancia que ya se midió.

### Un aviso sobre los clientes

delivery-apk está recibiendo 621 clientes de La Habana cuando PEDIDO tiene bastantes más.
El motivo está en `ClienteController::integration`: hace `if (empty($codigo)) continue;` y
luego `Cliente::upsert($filas, ['codigo'], ...)`.

El `codigo` es el de Parranda, y muchos clientes de PEDIDO no lo tienen — son los que se
dieron de alta por otra vía. Al saltárselos, se pierden.

**Recomendación:** clavar el upsert en `external_id` (el `id` que manda PEDIDO, que
siempre viene y siempre es único) en vez de `codigo`. Recupera unos 2.490 clientes.

## Resumen de lo que hay que tocar en delivery-apk

1. Quitar el endpoint que recibía de PEDIDO (`webhooks/pedido/domicilio`) y el job
   `ProcesarPedidoDomicilio`. Ya no llega nada por ahí.
2. El `Schedule::command(PedidoEnviarPendientes)->everyMinute()` de `routes/console.php`
   **se queda**: es lo único que hace falta.
3. Añadir `tasa` al cuerpo que manda `PedidoClient::enviarEntregas`.
4. Añadir `direccion` cuando el repartidor la corrija (ya se mandan
   `latitud`/`longitud`).
5. Leer `guardado` de la respuesta y no dar por bueno lo que no aparezca.
6. Cambiar el upsert de clientes a `external_id`.

## Pendiente por parte de PEDIDO

Hace falta la URL de la API de delivery-apk que da la **tasa de cambio**, para
configurarla en PEDIDO (`TASA_CAMBIO_URL`). PEDIDO la consulta cada 12 horas.
