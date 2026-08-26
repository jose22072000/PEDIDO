# Integración de la APK de domicilio con PEDIDO

Para Amado. Todo lo que hace falta, en orden.

---

## 0. Qué hace tu aplicación, y qué no

**Calcular el costo del domicilio y devolvérnoslo.** Eso es todo.

No editas pedidos, ni clientes, ni catálogos. Lo único que escribes en PEDIDO es lo que
tu aplicación produce:

| Escribes | Dónde acaba |
|---|---|
| `costo` | el precio de domicilio de ese pedido |
| `distanciaKm` + `distanciaDesde` | se guarda en el **cliente**, no sólo en el pedido |
| `latitud` / `longitud` | **sólo si el cliente venía sin coordenadas** |

---

## 1. Quién habla con quién

```
tablets  ⟷  tu backend Laravel  ⟷  PEDIDO
```

**Tu backend** es quien habla con PEDIDO. Las tablets siguen hablando contigo, como
hasta ahora — eso no cambia.

Por dos razones:

1. **La clave.** PEDIDO se autentica con una clave. En veinte tablets es una clave
   filtrada: cualquiera que abra el APK la saca, y revocarla obliga a actualizar las
   veinte. En tu backend hay una, en un `.env`, y se rota sin tocar un teléfono.
2. **Sin cobertura.** Tu backend puede sincronizar aunque las tablets estén en la
   calle, y cuando una vuelve a tener señal se encuentra el dato esperándola.

**No necesitas VPN ni instalar nada.** Todo va por HTTPS público.

---

## 2. Credenciales

```env
PEDIDO_WEBHOOK_URL=https://pedidos.procovar.cloud/api/webhooks/domicilio
PEDIDO_WEBHOOK_SECRET=08db23408a28ca8c9b6586ad1220b834203c79f7c867e5ddcc2e50b4128bbb45
PEDIDO_WEBHOOK_KEY=apk-domicilio-d0d04fd3bbde
PEDIDO_API_KEY=<te la pasa Jose>
PEDIDO_API_URL=https://pedidos.procovar.cloud/api
```

El **secret es el mismo en los dos lados**: con él firmamos lo que te mandamos y
verificamos lo que nos devuelves.

---

## 3. Lo que te llega (nosotros → tú)

Un `POST` a tu URL cada vez que un pedido pide domicilio.

**Cabeceras:**

```
X-Webhook-Key:       apk-domicilio-d0d04fd3bbde
X-Webhook-Signature: sha256=<HMAC-SHA256 del cuerpo, con el secret>
Content-Type:        application/json
```

**Cuerpo:**

```json
{
  "evento": "domicilio.solicitado",
  "pedidoId": "cmpoq7x2k0001abcd",
  "folio": "PAP25-4821",
  "fecha": "2026-08-25T13:04:00.000Z",
  "fechaComprometida": "2026-08-26T00:00:00.000Z",
  "estado": null,
  "requiereDomicilio": true,
  "pesoTotalKg": 148.32,
  "totalMercancia": 512.40,
  "sucursal":  { "codigo": "HAB", "nombre": "La Habana" },
  "vendedor":  {
    "codigo": "andy.almanza", "nombre": "ANDY JESUS ALMANZA LOPEZ",
    "gestor": { "usuario": "andy.almanza", "sucursalCodigo": "HAB" }
  },
  "cliente": {
    "codigo": "HAB-0412", "nombre": "CAFETERIA EL RAPIDO",
    "direccion": "Calle 23 esq. 12, Vedado",
    "telefono": "52341234",
    "latitud": 23.1345, "longitud": -82.3821,
    "distanciaKm": 3.2,
    "distanciaDesde": "almacen:HAB",
    "distanciaAt": "2026-08-20T10:12:00.000Z"
  },
  "items": [
    { "producto": "CERVEZA PARRANDA 0.33L CAJA 24U", "unidades": 240, "packs": 10, "pesoKg": 92.4 },
    { "producto": "MALTA GUAJIRA 1.5L CAJA 6U",      "unidades": 36,  "packs": 6,  "pesoKg": 55.92 }
  ]
}
```

**Lo que esto te ahorra:** el `pesoTotalKg` y el peso por línea ya vienen calculados.
**Ya no necesitas la VPN ni el token del almacén** para sacarlos.

**Cómo responder:** contesta `2xx` rápido y calcula después. Si tardas o fallas,
reintentamos con espera creciente. Puede llegarte el mismo pedido dos veces —trátalo
por `folio`.

---

## 4. Lo que nos devuelves (tú → nosotros)

```
POST https://pedidos.procovar.cloud/api/webhooks/domicilio
X-Webhook-Key:       apk-domicilio-d0d04fd3bbde
X-Webhook-Signature: sha256=<HMAC-SHA256 del cuerpo>
Content-Type:        application/json
```

```json
{
  "entregas": [
    {
      "folio": "PAP25-4821",
      "costo": 14.44,
      "distanciaKm": 3.2,
      "distanciaDesde": "almacen:HAB",
      "latitud": 23.1345,
      "longitud": -82.3821
    }
  ]
}
```

**Campos:**

| Campo | Obligatorio | Qué es |
|---|---|---|
| `folio` | sí* | El folio del pedido. *O `pedidoId`, si lo prefieres. |
| `costo` | **sí** | Precio del domicilio, en la misma moneda que el total. |
| `distanciaKm` | no | Distancia **por carretera** del almacén al cliente. |
| `distanciaDesde` | no | Desde qué punto la mediste. Ej: `"almacen:HAB"`. |
| `latitud` / `longitud` | no | Dónde está el cliente. **Sólo si venía sin coordenadas.** |

**Respuesta:**

```json
{
  "recibidas": 1,
  "aplicadas": 1,
  "rechazadas": []
}
```

Una rechazada trae su motivo y **no descarta las demás**:

```json
{ "recibidas": 2, "aplicadas": 1,
  "rechazadas": [ { "folio": "PAP25-9999", "motivo": "folio no encontrado" } ] }
```

**En lote hasta 500** por llamada, e **idempotente**: mandar lo mismo dos veces deja lo
mismo. Si no estás seguro de que llegó, repite.

---

## 5. Las tres cosas que escribes, explicadas

### `costo`
El precio del domicilio de ese pedido. Aparece como una línea más — un producto de
servicio llamado `ENTREGA A DOMICILIO`.

### `distanciaKm` + `distanciaDesde`
**Se guarda en el CLIENTE, no sólo en el pedido.** Del almacén a un cliente hay la
distancia que hay: no cambia de un pedido al siguiente. Calculada una vez, sirve para
todos sus pedidos.

Por eso pedimos `distanciaDesde`: **desde qué punto la mediste**. Hoy siete de nuestros
diez almacenes tienen la ubicación puesta en el centro de la ciudad. Cuando se
corrijan, las distancias medidas desde el punto viejo habrá que rehacerlas — y con esa
marca sabremos cuáles. Sin ella, o se rehacen todas o no sirve ninguna.

### `latitud` / `longitud`
**Sólo si el cliente venía sin coordenadas.** Hay 123 así: llegan del consolidado de
Parranda sin geolocalizar, y a ésos no se les puede cotizar hasta que alguien diga
dónde están. Quien va a llevar el pedido sí lo sabe.

**Si el cliente ya tiene coordenadas, las tuyas se ignoran.** No es desconfianza: las
que están vienen del dato oficial de Parranda, y si la APK pudiera sobreescribirlas, el
error de un repartidor movería a ese cliente de sitio para todos los sistemas —rutas
incluido— sin que nadie supiera de dónde salió el cambio. Para corregir una que esté
mal se hace en Clientes, donde queda registrado quién lo hizo.

---

## 6. No midas lo que ya está medido

```
GET /api/integration/clients?sucursalCodigo=HAB&limit=500
x-api-key: <PEDIDO_API_KEY>
```

Cada cliente viene con:

```json
{ "codigo": "HAB-0412", "nombre": "CAFETERIA EL RAPIDO",
  "latitud": 23.1345, "longitud": -82.3821,
  "distanciaKm": 3.2,
  "distanciaDesde": "almacen:HAB",
  "distanciaAt": "2026-08-20T10:12:00.000Z",
  "vendedor": { "codigo": "andy.almanza", "sucursalCodigo": "HAB" },
  "updatedAt": "2026-08-25T09:15:00.000Z" }
```

**Si `distanciaKm` viene y `distanciaDesde` coincide con el almacén de hoy, no la
recalcules.** Si `distanciaDesde` es distinto, ese almacén se movió: toca medir otra vez.

**Filtros:** `sucursalCodigo`, `vendedor` (su cartera), `since` (sólo lo que cambió
desde esa fecha), `limit` + `cursor`.

---

## 7. Los otros endpoints que puedes necesitar

Todos con `x-api-key: <PEDIDO_API_KEY>`.

```
GET /api/integration/orders?estado=en_proceso&desde=2026-08-25&hasta=2026-08-26
GET /api/integration/orders?folio=PAP25-4821
GET /api/integration/orders?since=2026-08-25T11:30:00.000Z
GET /api/integration/clients?sucursalCodigo=HAB&vendedor=andy.almanza
GET /api/productos?sucursalCodigo=HAB          ← peso, precio y stock por sucursal
```

Cada filtro va por su cuenta y se combinan.

**Sincronización incremental:** guarda el `updatedAt` mayor de cada tanda y mándalo
como `since` la próxima vez. La segunda llamada suele traer nada o cuatro filas.

Lo que **NO** hay que hacer es pedir `/integration/orders` sin filtros en cada ciclo:
eso es el histórico entero, 55.000 pedidos.

---

## 8. Las dos cosas que te van a costar una tarde

Tu backend es Laravel, así que:

**1. Firma sobre el cuerpo CRUDO.**

```php
// BIEN
$firma = hash_hmac('sha256', $request->getContent(), $secret);

// MAL — al reserializar cambia el orden de las claves y la firma no cuadra JAMÁS,
// por un motivo que no se ve en pantalla
$firma = hash_hmac('sha256', json_encode($request->all()), $secret);
```

**2. Manda el cuerpo que firmaste.**

```php
// BIEN
$cuerpo = json_encode($datos);
Http::withHeaders([
    'X-Webhook-Key'       => $key,
    'X-Webhook-Signature' => 'sha256=' . hash_hmac('sha256', $cuerpo, $secret),
    'Content-Type'        => 'application/json',
])->withBody($cuerpo, 'application/json')->post($url);

// MAL — Laravel serializa el array por su cuenta, el cuerpo que sale no es el que
// firmaste, y siempre recibes 401
Http::withHeaders([...])->post($url, $datos);
```

**Prueba la firma primero, sin tocar datos:**

```
POST https://pedidos.procovar.cloud/api/webhooks/ping
```

Mismas cabeceras, cualquier cuerpo. Si contesta `{"ok":true}`, la firma está bien y
puedes ir a por los datos. Si da `401`, es la firma — y no pierdes la tarde buscando en
otro sitio.

---

## 9. Detalles que muerden

**El folio sirve como identificador.** Comprobado sobre los datos reales: 55.036 folios
distintos de 55.088 pedidos. Los pocos repetidos son de una importación equivocada de
marzo. Si alguna vez te contestamos `"folio repetido en esta sucursal"`, añade
`vendedorCodigo` a esa entrega.

**Una instalación, una sucursal.** Si pides otra con `?sucursalCodigo=`, contestamos
**403 a propósito**: es lo que impide que la instalación de Camagüey vea pedidos de
Santiago. Si te salen muchas `rechazadas`, comprueba que apuntas a la instalación
correcta.

**`vendedor` y `gestor` pueden venir `null`.** No es un fallo de la API: es un vendedor
sin gestor asignado en PEDIDO. Se arregla allí, no en tu código.

**Sin secret configurado devolvemos 503.** Un endpoint que escribe en los pedidos y
está abierto a internet es peor que uno que no existe.

---

## 10. Lo que hay que arreglar de nuestro lado, y te afecta

**Siete de los diez almacenes tienen la ubicación puesta en el centro de la ciudad**,
no donde está el almacén de verdad. Sólo Camagüey y La Habana están bien.

Mientras eso no se corrija, las distancias que calcules van a estar mal **desde el
origen** — y no será culpa de tu cálculo. Por eso conviene que mandes siempre
`distanciaDesde`: el día que se corrija un almacén, sabremos exactamente qué distancias
hay que rehacer.
