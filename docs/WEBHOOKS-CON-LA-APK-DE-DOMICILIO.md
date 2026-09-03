# Webhooks entre PEDIDO y la APK de domicilio

Para Amado. Dos direcciones, un solo secret.

## El reparto

Nosotros sabemos **qué** se pide, **cuánto pesa** y **dónde** hay que llevarlo. Tú sabes
**cuánto cuesta llevarlo**.

```
PEDIDO  ──  domicilio.solicitado  ──▶  tu backend     (peso, coordenadas, total sin domicilio)
PEDIDO  ◀──  el costo             ──   tu backend     (costo del domicilio, y ya)
```

El pedido sale de aquí con el total de la mercancía **ya hecho y sin la línea de
domicilio**. Vuelve **sólo con esa línea**. Nosotros la sumamos: en PEDIDO el domicilio
es un producto de servicio llamado `ENTREGA A DOMICILIO`, no un campo aparte.

Esto sustituye al polling. Ya no hace falta preguntar cada tantos minutos si hay algo
nuevo: te avisamos.

## Configurar (una vez)

Jose lo hace desde **Configuración → Mantenimiento → Webhook Domicilio (APK)**:

1. **URL de la APK (salida)** — la tuya, donde recibes los avisos.
2. **Generar** el secret → sale en pantalla **una sola vez**. Ése es el que tienes que
   guardar en tu `.env`. No se puede volver a ver; si se pierde, se genera otro y hay
   que cambiarlo en los dos lados.
3. **Key** (opcional) — un identificador que viaja en `X-Webhook-Key`, por si algún día
   hay más de un origen.
4. **Probar** — manda un aviso `{"evento":"prueba"}` a tu URL. Si eso no llega, no sigas:
   el problema es de configuración y se arregla ahora, no cuando haya pedidos de verdad
   esperando.

La **URL de entrada** —la que tú llamas— también sale en esa pantalla. Es:

```
https://pedidos.procovar.cloud/api/webhooks/domicilio
```

Todo eso se edita desde la aplicación, no desde el `.env` del servidor. Es lo que
permite rotar el secret sin desplegar nada — que es justo lo que hace falta el día que
haya que rotarlo de verdad.

## 1. Lo que te mandamos

`POST` a tu URL, con estas cabeceras:

```
Content-Type: application/json
X-Webhook-Key: <la key, si se configuró>
X-Webhook-Signature: sha256=<hmac del cuerpo>
```

```json
{
  "evento": "domicilio.solicitado",
  "pedidoId": "cmpo...", "folio": "12345",
  "estado": "en_proceso", "requiereDomicilio": true,
  "fecha": "2026-08-24T00:00:00.000Z",
  "fechaComprometida": "2026-08-26T00:00:00.000Z",

  "sucursalCodigo": "CAM", "sucursalNombre": "CAMAGUEY",
  "vendedor": {
    "codigo": "andy.almanza", "nombre": "ANDY ALMANZA",
    "sucursalCodigo": "CAM",
    "gestor": { "usuario": "yamileidy", "sucursalCodigo": "CAM" }
  },

  "cliente": {
    "codigo": "CM01TCP0805", "nombre": "IRAELIA SILOT PEREZ",
    "direccion": "Calle 3ra #45", "municipio": "Camagüey", "zona": "Centro",
    "telefono": "53123456",
    "latitud": 21.3808, "longitud": -77.9169
  },

  "items": [
    { "sku": "ALIM0002", "producto": "ACEITE SOYA SAUDE 900 ML CAJA 20U",
      "unidades": 20, "packs": 1,
      "pesoUnidadKg": 16.4445, "pesoKg": 16.445,
      "precioUnidad": 43.4, "importe": 43.4 }
  ],
  "pesoTotalKg": 16.445,
  "totalMercancia": 43.4,
  "lineasSinPrecio": 0, "lineasSinPeso": 0,
  "costoDomicilio": null
}
```

Lo que importa de ahí:

- **`pesoTotalKg`** y **`items[].pesoKg`** — el peso que antes sacabas del almacén por
  VPN. Ya no te hace falta ni la VPN ni el token: lo traemos de Ventra y te lo damos
  hecho, con el precio y el stock de **esa** sucursal.
- **`cliente.latitud` / `longitud`** — sólo te avisamos de pedidos cuyo cliente tiene
  coordenadas. Sin ellas no hay nada que cotizar, y mandártelo sería darte trabajo para
  que contestes que no puedes.
- **`totalMercancia`** — el total **sin** domicilio. Es lo que tú completas.
- **`vendedor` → `gestor` → `sucursalCodigo`** — a quién se le atribuye la entrega.
- **`costoDomicilio`** — normalmente `null`. Si viene con valor, es un reenvío de algo ya
  cotizado; puedes ignorarlo.

**Contesta 2xx rápido.** Si tardas o devuelves error, lo reintentamos con espera
creciente (5 s, 10 s, 20 s…). Encola por tu lado y contesta; no calcules dentro del
request.

**Puede llegarte el mismo pedido dos veces.** Un reintento nuestro, o un pedido que se
editó. Trátalo por `pedidoId`: si ya lo tienes, actualízalo.

### Verificar la firma (Laravel)

```php
$crudo  = $request->getContent();               // el cuerpo EXACTO, sin decodificar
$firma  = 'sha256=' . hash_hmac('sha256', $crudo, config('services.pedido.secret'));

if (! hash_equals($firma, $request->header('X-Webhook-Signature', ''))) {
    abort(401);
}
```

Dos cosas que muerden:

- Firma sobre `$request->getContent()`, **no** sobre `json_encode($request->all())`. Al
  reserializar cambia el orden de las claves o un espacio, y la firma no cuadra nunca
  por un motivo que no se ve en pantalla.
- `hash_equals`, no `===`. Un `===` corta en el primer byte distinto y el tiempo que
  tarda dice cuántos acertaste; con eso se adivina una firma byte a byte.

## 2. Lo que nos devuelves

```
POST https://pedidos.procovar.cloud/api/webhooks/domicilio
Content-Type: application/json
X-Webhook-Key: <la key, si se configuró>
X-Webhook-Signature: sha256=<hmac del cuerpo>
```

```json
{ "entregas": [
    { "pedidoId": "cmpo...", "costo": 14.44, "distanciaKm": 3.2 },
    { "pedidoId": "cmpq...", "costo": 11.80, "distanciaKm": 2.4,
      "latitud": 21.3811, "longitud": -77.9172, "distanciaDesde": "almacen:HAB" },
    { "folio": "12346", "vendedorCodigo": "andy.almanza", "costo": 9.10 }
] }
```

### Y de paso, DÓNDE VIVE EL CLIENTE

`latitud` y `longitud` son opcionales y **son la forma de arreglar el mayor problema que
tenemos hoy**: hay clientes que llegan de Parranda sin coordenadas, y a un cliente sin
coordenadas no se le puede cotizar el domicilio, ni ponerlo en un mapa, ni meterlo en una
ruta. Quien va a llevarle el pedido está delante de la puerta: es el único momento en que
ese dato es fácil.

- Mándalas cuando la tablet esté **en casa del cliente**, con la ubicación del
  dispositivo. O escritas a mano si se averiguan por teléfono.
- Se guardan en el cliente, no en el pedido: sirven para **todos** sus pedidos siguientes.
- Si ya tenía coordenadas, se corrigen y **lo anterior queda guardado**. No se pierde nada.
- Se descartan las que caen fuera de Cuba y las idénticas a las que ya había. La
  respuesta lo dice: mira `aplicadas[].guardado`, que trae `ubicacionCliente` cuando la
  ubicación entró de verdad.

`distanciaDesde` dice desde qué punto mediste (`"almacen:HAB"`). Sin eso la distancia es
un número sin contexto y no se puede volver a usar.

**Esto ya está funcionando de nuestro lado.** No hay que desplegar nada aquí: en cuanto
la APK empiece a mandarlo, entra.

- **En lote**, hasta 500 por llamada.
- **Idempotente**: mandar dos veces lo mismo deja lo mismo. Ante la duda, reintenta.
- **Identifica por `pedidoId`** siempre que puedas. Por `folio` hace falta además
  `vendedorCodigo`, porque **el folio no es único**: dos vendedores pueden repetirlo (la
  clave real es sucursal + folio + vendedor). Si mandas un folio ambiguo lo rechazamos
  con ese motivo, en vez de escribir en el pedido equivocado.

Respuesta:

```json
{ "recibidas": 2, "aplicadas": 2, "rechazadas": [] }
```

Cada entrega se responde por separado. Que un folio venga mal **no descarta** las otras
diecinueve que venían bien — mira `rechazadas` y reintenta sólo ésas.

### Firmar (Laravel)

```php
$cuerpo = json_encode(['entregas' => $entregas]);

Http::withHeaders([
    'Content-Type'        => 'application/json',
    'X-Webhook-Key'       => config('services.pedido.key'),
    'X-Webhook-Signature' => 'sha256=' . hash_hmac('sha256', $cuerpo, config('services.pedido.secret')),
])->withBody($cuerpo, 'application/json')
  ->post('https://pedidos.procovar.cloud/api/webhooks/domicilio');
```

**`withBody`, no `->post($url, $array)`.** Si dejas que Laravel serialice el array, el
cuerpo que sale por el cable no es el mismo que firmaste y siempre te devolvemos 401.

### Probar la firma sin tocar datos

```
POST https://pedidos.procovar.cloud/api/webhooks/ping
```

Mismas cabeceras, el cuerpo que quieras. Devuelve `{ "ok": true }` si la firma cuadra.
Es lo primero que hay que hacer: si esto no pasa, el problema es de firma y no de datos.

## 3. Cuando un pedido CAMBIA después de que lo cotizaste

Esto es nuevo y es lo que falta por hacer en los dos lados.

El cliente pide veinte cajas y se lleva quince. Eso se ve al facturar, y para entonces tú
ya le pusiste precio al domicilio de un pedido que pesaba otra cosa. Como la APK trabaja
sin conexión, no hay forma de preguntarte: hay que avisarte.

```json
{
  "evento": "pedido.cambiado",
  "pedidoId": "cmpo...", "folio": "PRM25-260901-1808-3",
  "facturaNumero": "1024348",
  "motivo": "la factura cambió lo pedido",

  "costoDomicilioActual": 14.44,

  "items": [ ... ],
  "pesoTotalKg": 12.10,
  "pesoTotalAnteriorKg": 16.445,
  "totalMercancia": 38.20,

  "cliente": { ... }
}
```

Es el mismo cuerpo de `domicilio.solicitado` con tres cosas más: el número de factura, el
peso que tenía antes, y el costo que tú ya habías puesto. Lo que se espera de vuelta es lo
mismo de siempre —una entrega con el costo nuevo— por la misma URL de entrada.

### La regla que decide si te llega

**Sólo se avisa de los pedidos que YA tienen costo de domicilio puesto.**

Si un pedido cambió y todavía no lo has cotizado, no te mandamos nada: cuando te llegue
por el camino normal ya vendrá con lo facturado, y avisarte de un cambio sobre algo que
nunca viste es ruido. Y si el pedido no lleva domicilio, tampoco.

O sea, te llega si y sólo si:

1. El cotejo contra la factura dejó el pedido en `cambiado`, **y**
2. ese pedido ya tiene `costoDomicilio` con valor.

### Y por qué el folio lleva sufijo

Verás folios como `PRM25-260901-1808-3`. Un vendedor usa **un folio para toda su jornada**
y mete debajo a todos sus clientes; nosotros los separamos añadiendo `-1`, `-2`… Cada uno
es un pedido distinto, de un cliente distinto. El sufijo forma parte del folio: trátalo
como texto y no intentes quitárselo.

## Qué contestamos cuando algo va mal

| Código | Qué pasó | Qué hacer |
|---|---|---|
| `401` | Firma inválida o key que no coincide | Revisa el secret y que firmes el cuerpo crudo |
| `503` | El webhook no está configurado o está apagado | Que Jose lo mire en Configuración |
| `400` | No vino ninguna entrega | Revisa el formato del cuerpo |
| `413` | Más de 500 entregas | Trocéalo |

Un `rechazadas: [{ "folio": "...", "motivo": "..." }]` **no** es un error de conexión:
llegó bien y hay algo concreto que arreglar en esa entrega. El motivo lo dice.

## Lo que ya no hace delivery

Delivery **no calcula ningún precio** (03/09/2026). Llegó a tener cinco fórmulas escritas
y varias vivas a la vez, así que el mismo pedido costaba una cosa u otra según por dónde
entrara. Se quitaron todas, con la pantalla que las configuraba.

El precio del domicilio es **tuyo y de nadie más**. Delivery se queda con lo suyo: el peso
—para saber si la carga cabe en el camión—, la distancia y el recorrido, las rutas y el
pre y post-despacho.

Los endpoints de lectura (`GET /integration/orders`, `GET /integration/clients`,
`GET /productos`) siguen igual y son tuyos: los webhooks te avisan **cuándo** pasa algo,
y esos endpoints te dejan **traerte** lo que necesites cuando quieras — el arranque de
una tablet nueva, una sincronización completa, o recuperar lo de un día que estuviste
caído. Está todo en [COMO-CONECTAR-LA-APK-CON-PEDIDO.md](COMO-CONECTAR-LA-APK-CON-PEDIDO.md).

## Si estuviste caído

No pasa nada. Los avisos se reintentan solos unas cuantas veces, y lo que se dé por
perdido sigue contado: en Configuración se ve **cuántos pedidos siguen sin cotizar** y
hay un botón **Reencolar pendientes** que los vuelve a mandar todos.

Nada se pierde en silencio, que es lo que pasaba antes: si el cálculo no se hacía, se
notaba cuando alguien preguntaba por qué ningún pedido tenía precio de domicilio.
