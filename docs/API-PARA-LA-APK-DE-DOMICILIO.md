# Endpoints de PEDIDO para la APK de domicilio

Para Amado. Todo lo que la APK necesita de PEDIDO para bajarse los datos, tenerlos en
la tablet y devolver el resultado.

## Autenticación

**Una cabecera en todas las llamadas**:

```
x-api-key: pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

La key se emite desde el panel (Configuración → Integraciones → API keys) y se enseña
**una sola vez**: se guarda hasheada, así que si se pierde hay que emitir otra. Se
puede revocar en cualquier momento sin tocar nada más.

No hay usuario ni contraseña: la APK es una máquina, no una persona. No uses el login
del panel — esa sesión caduca y está pensada para un navegador.

**Base:** `https://pedidos.procovar.cloud/api`

## Lo importante antes de escribir código

Cada instalación de PEDIDO es de **UNA sucursal**. La integración va scopeada a esa
sucursal: pidas lo que pidas, solo salen sus pedidos y sus clientes. Si mandas
`?sucursalCodigo=` de otra, contesta **403** a propósito. No es un fallo, es el
cortafuegos: un domicilio de Camagüey no puede ver pedidos de Santiago.

---

## 1. Bajarse los clientes (para tenerlos en la tablet)

```
GET /integration/clients?sucursalCodigo=CAM&limit=500
```

Devuelve **solo los clientes con coordenadas**. Sin lat/lng no se puede calcular un
domicilio, así que traerlos sería cargar la tablet con lo que no sirve.

```json
{
  "count": 500,
  "clients": [
    {
      "id": "clx...", "codigo": "CM01TCP1060", "nombre": "BERNABE DIAZ DIAZ",
      "zona": null, "direccion": "Calle 23 #54", "municipio": "Camagüey",
      "tipoCliente": "Kiosko", "estadoCompra": "Compra",
      "latitud": 21.38, "longitud": -77.91, "geolocalizacion": "21.38,-77.91",
      "sucursalId": "clx...", "sucursalCodigo": "CAM", "sucursalNombre": "Camagüey"
    }
  ],
  "nextCursor": "clx..."
}
```

**Paginación:** manda `limit` y, para la página siguiente, `cursor=<nextCursor>`.
Cuando la página venga **incompleta** (menos filas que el `limit`) ya no queda nada
más y `nextCursor` no aparece. Es el corte: no hace falta una llamada extra para
descubrir que se acabó.

## 2. Bajarse los pedidos que hay que cotizar

```
GET /integration/orders?onlyPending=1&limit=500
```

`onlyPending=1` trae **solo los que requieren domicilio y todavía no tienen costo**.
Es lo que la APK quiere: la cola de trabajo. Sin ese parámetro salen todos los que
tienen cliente geolocalizado, que sirve para rellenar la tablet la primera vez.

```json
{
  "count": 12,
  "orders": [
    {
      "id": "clx...", "folio": "PYH25-260824-1852",
      "sucursalId": "clx...", "sucursalCodigo": "CAM", "sucursalNombre": "Camagüey",
      "direccion": "Calle Eduardo R. Chivas #130", "encargado": "BENITO SIERRA",
      "telefono": "55948233",
      "fecha": "2026-08-24T00:00:00.000Z", "fechaComprometida": "2026-08-31T...",
      "estado": null, "pedidoCobrado": null,
      "requiereDomicilio": true, "costoDomicilio": null,
      "updatedAt": "2026-08-24T11:53:00.000Z",

      "vendedor": {
        "id": "clx...", "codigo": "diana.acosta", "nombre": "DIANA ACOSTA SOSA",
        "activo": true, "sucursalId": "clx...",
        "gestor": {
          "id": "clx...", "usuario": "yamileidy",
          "sucursalId": "clx...", "sucursalCodigo": "CAM", "sucursalNombre": "Camagüey"
        }
      },

      "cliente": { "...igual que arriba..." },
      "items": [
        { "codigo": "10234", "producto": "MALTA GUAJIRA 0.33L",
          "unidades": 120, "packs": 20, "descripcion": null }
      ]
    }
  ]
}
```

### La jerarquía: de quién es cada pedido

Esto es lo que faltaba y por lo que llegaba todo suelto. La cadena es:

```
sucursal  →  gestor (usuario)  →  vendedor  →  pedido  →  cliente
```

- **`vendedor`** — quién hizo el pedido. Es a quien hay que atribuirle la entrega.
- **`vendedor.gestor`** — el usuario del que cuelga ese vendedor. En PEDIDO la sucursal
  de un pedido se deriva así: **vendedor → gestor → sucursal del gestor**.
- **`sucursalCodigo`** (el de arriba) es la sucursal DEL PEDIDO;
  **`vendedor.gestor.sucursalCodigo`** es la del gestor. Casi siempre coinciden, y
  cuando no, es justo lo que hay que mirar: significa que ese vendedor está mal
  enlazado.

`vendedor` puede venir en `null` (pedido sin vendedor asignado) y `gestor` también
(vendedor "Sin asignar"). No es un fallo de la API: es un dato que falta en PEDIDO y
que hay que arreglar allí, en Vendedores.

### Buscar uno concreto

```
GET /integration/orders?folio=1852
```

Por folio, que es como lo nombra todo el mundo — es lo que lleva escrito el papel que
el repartidor tiene en la mano. Busca por coincidencia parcial y sin distinguir
mayúsculas: nadie teclea un folio entero.

### No te traigas el histórico: filtra

Una tablet por repartidor, sincronizando por datos móviles y media jornada sin
cobertura. Bajarse los 44.700 pedidos en cada arranque son megas y minutos que no
tiene, y el 99% son de hace meses.

| Parámetro | Qué filtra | Cuándo usarlo |
|---|---|---|
| `desde=YYYY-MM-DD` / `hasta=YYYY-MM-DD` | La **fecha del pedido** | "Los de hoy", "los de ayer" |
| `estado=en_proceso` | El estado | Lo que se va a repartir HOY |
| `since=<ISO>` | **Cuándo cambió** el pedido | El incremental de verdad |
| `folio=1852` | El folio | Buscar uno concreto |

**La llamada que le interesa a la tablet antes de salir** — los de ayer y hoy que están
en proceso, para llevarlos encima sin cobertura:

```
GET /integration/orders?estado=en_proceso&desde=2026-08-23&hasta=2026-08-24
```

Y después, para mantenerlos al día durante la jornada:

```
GET /integration/orders?estado=en_proceso&since=2026-08-24T11:30:00.000Z
```

**Sobre `estado`:** «en proceso» y «expirado» no son columnas en la base. El único
estado guardado es `completada`; expirado se deduce de que la fecha comprometida ya
pasó. La API lo traduce, así que desde fuera se piden por su nombre y ya — no hace falta
saber esa interioridad ni replicar la regla en la APK.

**`since` es el que hace que una sync sea instantánea.** Cada pedido viene con su
`updatedAt`: guarda el MAYOR de la tanda y mándalo como `since` la próxima vez. La
segunda sincronización suele traer nada o cuatro filas.

Se combinan: `?desde=…&since=…` es "de los de hoy, lo que cambió desde la última vez".

## 3. Devolver el costo calculado

```
POST /integration/orders/domicilio
Content-Type: application/json

{ "updates": [
    { "id": "clx...", "costo": 14.44, "distanceKm": 3.2 },
    { "id": "cly...", "costo": 2.21 }
] }
```

**En lote, no de uno en uno.** La tablet trabaja sin cobertura la mitad del día: manda
todo lo que calculaste cuando vuelvas a tener señal, en una sola llamada.

```json
{ "updated": 2, "skipped": 0, "errors": [] }
```

- `updated` — escritos.
- `skipped` — el pedido no existe **o es de otra sucursal**. No es un error: es el
  guardia haciendo su trabajo. Si te salen muchos, estás apuntando a la instalación
  equivocada.
- `errors` — con el id y el motivo, uno por uno. Un pedido que falla no tumba el resto
  del lote.

Es **idempotente**: mandar el mismo costo dos veces deja lo mismo. Si la tablet no está
segura de que el envío llegó, que lo repita — es más barato que perderlo.

---

## 4. El catálogo con precio y existencias, por sucursal

```
GET /productos?sucursalCodigo=CAM&soloConStock=1&limit=1000
```

```json
{
  "count": 127,
  "productos": [
    { "sku": "ALIM0010", "nombre": "ACEITE SOYA SAUDE 500 ML CAJA 20U",
      "categoria": "ALIM", "unidad": "unidad",
      "pesoKg": 9.6, "stock": 340, "precio": 12.5,
      "sucursalCodigo": "CAM", "sucursalNombre": "Camagüey",
      "traidoAt": "2026-08-24T15:30:00.000Z" }
  ]
}
```

**El precio y el stock son POR SUCURSAL**: el mismo producto no vale lo mismo en
Camagüey que en Santiago, así que `sucursalCodigo` no es opcional en la práctica.

`traidoAt` dice de cuándo es el dato. Sale de una copia local que se refresca desde el
almacén cada media hora — así un corte de VPN no deja la tablet sin catálogo, solo con
uno un poco viejo. Si ves `traidoAt` de hace días, avisa: la VPN está caída.

`pesoKg` es el que necesitas para calcular el domicilio, y ya viene aquí: no hace falta
que la APK hable con el almacén.

## Cómo sincronizar sin volverse loco

1. **Al instalar / una vez al día:** bájate los clientes enteros (paso 1, paginando) y
   el catálogo de tu sucursal (paso 4). Cambian poco.
2. **Cada X minutos, con señal:** pide `onlyPending=1` con `since=<tu última sync>`
   (paso 2). Suele venir vacío o con cuatro filas.
3. **Cuando calcules:** acumula y manda el lote (paso 3). Si falla, guarda y reintenta:
   repetir no rompe nada.

Lo que NO hay que hacer: pedir `/integration/orders` sin filtros en cada arranque. Eso
es el histórico entero, y por datos móviles es la diferencia entre sincronizar en dos
segundos o en dos minutos.

No hace falta websocket ni push. Preguntar cada pocos minutos es más simple, sobrevive
a los cortes de señal y no deja a la tablet esperando una conexión que no va a llegar.

---

## Lo que va a cambiar (avisado por adelantado)

El costo del domicilio deja de ser un campo aparte del pedido y pasa a ser **una línea
más**, un producto de servicio llamado **ENTREGA A DOMICILIO**. Para la APK cambia poco
—se sigue mandando el costo igual, por el mismo endpoint— pero al leer un pedido ese
importe va a aparecer también dentro de `items`. Que la APK no se sorprenda si ve una
línea de producto que no pidió nadie.
