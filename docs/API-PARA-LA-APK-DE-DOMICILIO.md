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
      "direccion": "Calle Eduardo R. Chivas #130", "telefono": "55948233",
      "fecha": "2026-08-24T00:00:00.000Z", "fechaComprometida": "2026-08-31T...",
      "estado": null, "pedidoCobrado": null,
      "requiereDomicilio": true, "costoDomicilio": null,
      "cliente": { "...igual que arriba..." },
      "items": [
        { "codigo": "10234", "producto": "MALTA GUAJIRA 0.33L",
          "unidades": 120, "packs": 20, "descripcion": null }
      ]
    }
  ]
}
```

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

## Cómo sincronizar sin volverse loco

1. **Al instalar / una vez al día:** bájate los clientes enteros (paso 1, paginando) y
   guárdalos en la tablet. Cambian poco.
2. **Cada X minutos, con señal:** pide `onlyPending=1` (paso 2). Es corto: solo lo que
   falta por cotizar.
3. **Cuando calcules:** acumula y manda el lote (paso 3). Si falla, guarda y reintenta:
   repetir no rompe nada.

No hace falta websocket ni push. Preguntar cada pocos minutos es más simple, sobrevive
a los cortes de señal y no deja a la tablet esperando una conexión que no va a llegar.

---

## Lo que va a cambiar (avisado por adelantado)

El costo del domicilio deja de ser un campo aparte del pedido y pasa a ser **una línea
más**, un producto de servicio llamado **ENTREGA A DOMICILIO**. Para la APK cambia poco
—se sigue mandando el costo igual, por el mismo endpoint— pero al leer un pedido ese
importe va a aparecer también dentro de `items`. Que la APK no se sorprenda si ve una
línea de producto que no pidió nadie.
