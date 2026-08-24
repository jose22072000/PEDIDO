# Cómo conecta la APK de domicilio con PEDIDO

Para Amado. Lo que hacía delivery, y cómo lo hace ahora tu APK.

## Lo primero: quién llama a quién

Tu APK ya tiene su backend Laravel, y las tablets hablan con él:

```
tablet  →  /api/v1/dispositivo/catalogo     (productos, precios, almacenes, tasa)
tablet  →  /api/v1/dispositivo/datos
tablet  →  /api/v1/dispositivo/sync         (sube las entregas)
```

**Eso no cambia.** Quien habla con PEDIDO es **tu backend**, no la tablet:

```
tablets  ⟷  tu backend Laravel  ⟷  PEDIDO
```

No es un capricho de diseño, son dos razones concretas:

1. **La API key.** PEDIDO se autentica con `x-api-key`. Ponerla en veinte tablets es
   tenerla filtrada: cualquiera que saque el APK y lo abra la tiene, y revocarla obliga
   a actualizar las veinte. En tu backend hay una, en un `.env`, y se rota sin tocar
   ningún teléfono.
2. **La tablet ya trabaja sin cobertura.** Tu backend puede sincronizar con PEDIDO cada
   pocos minutos aunque las tablets estén en la calle, y cuando una vuelve a tener
   señal se encuentra el dato ya esperándola.

## El equivalente de lo que hacía delivery

Delivery hacía exactamente tres cosas. Las mismas, con las mismas rutas:

| Delivery hacía | Tú llamas a | Y lo sirves como |
|---|---|---|
| Jalar pedidos con geo del cliente | `GET /integration/orders` | los pedidos que la tablet va a repartir |
| Espejar los clientes geolocalizados | `GET /integration/clients` | tu tabla de clientes |
| Escribir de vuelta el costo | `POST /integration/orders/domicilio` | lo que subes tras `dispositivo/sync` |

Y una cuarta que delivery no tenía: **el catálogo con precio y peso por sucursal**, que
antes sacabas del almacén por VPN.

## 1. El catálogo — reemplaza tu lectura del warehouse

```
GET /productos?sucursalCodigo=CAM
x-api-key: pk_...
```

```json
{ "productos": [
  { "sku": "ALIM0002", "nombre": "ACEITE SOYA SAUDE 900 ML CAJA 20U",
    "categoria": "ALIM", "unidad": "caja",
    "pesoKg": 16.4445, "stock": 0, "precio": 43.4,
    "sucursalCodigo": "CAM", "traidoAt": "2026-08-24T15:30:00.000Z" }
]}
```

Esto alimenta tu `/api/v1/dispositivo/catalogo` — la tabla `productos` de la tablet
(`codigo`, `descripcion`, `peso_kg`) sale de aquí tal cual.

**Ya no necesitas la VPN ni el token del almacén.** PEDIDO lo trae de Ventra cada media
hora y te lo sirve. `pesoKg` es el mismo que usabas para calcular; `precio` y `stock`
son **de esa sucursal** — el mismo producto no vale igual en Camagüey que en Santiago.

`traidoAt` dice de cuándo es el dato. Si se queda viejo, la VPN de PEDIDO al almacén
está caída: el catálogo sigue sirviéndose (el último bueno) pero conviene avisar.

## 2. Los pedidos que hay que repartir

```
GET /integration/orders?estado=en_proceso&desde=2026-08-23&hasta=2026-08-24
```

Cada filtro va por su cuenta y se combinan: `estado`, `desde`/`hasta`, `folio`,
`since`, `onlyPending`. Lo que le interesa a una tablet es lo de ayer y hoy en proceso.

Cada pedido trae **de quién es**, que es lo que faltaba:

```json
"vendedor": {
  "codigo": "diana.acosta", "nombre": "DIANA ACOSTA SOSA",
  "gestor": { "usuario": "yamileidy", "sucursalCodigo": "CAM" }
}
```

La cadena es `sucursal → gestor → vendedor → pedido → cliente`. Con eso sabes a qué
vendedor atribuir la entrega y de qué sucursal sale, sin adivinarlo.

## 3. Los clientes

```
GET /integration/clients?sucursalCodigo=CAM&vendedor=andy.almanza
```

Solo los que tienen coordenadas (sin ellas no hay domicilio que calcular). Con
`vendedor` te traes **su cartera** en vez de los 8.850 de la sucursal.

## 4. Devolver el costo

Cuando una tablet suba sus entregas a tu `dispositivo/sync`, tú escribes el costo en
PEDIDO:

```
POST /integration/orders/domicilio
{ "updates": [ { "id": "clx...", "costo": 14.44, "distanceKm": 3.2 } ] }
```

**En lote y es idempotente**: mandar lo mismo dos veces deja lo mismo. Si no estás
seguro de que llegó, repite.

## Sincronizar sin bajarte todo cada vez

`since` es el que hace que una sync sea instantánea. Está en **pedidos y en clientes**:

```
GET /integration/orders?estado=en_proceso&since=2026-08-24T11:30:00.000Z
GET /integration/clients?sucursalCodigo=CAM&since=2026-08-24T11:30:00.000Z
```

Cada fila viene con su `updatedAt`. Guarda el **mayor** de la tanda y mándalo como
`since` la próxima vez: la segunda llamada suele traer nada o cuatro filas.

Un ritmo que funciona:

- **Al arrancar tu backend / una vez al día:** catálogo (paso 1) y clientes completos.
- **Cada 5 minutos:** pedidos y clientes con `since`.
- **Cuando una tablet sincroniza:** subes sus costos (paso 4).

Lo que NO hay que hacer es pedir `/integration/orders` sin filtros en cada ciclo: eso es
el histórico entero, 44.700 pedidos.

## Detalles que muerden

**Una instalación, una sucursal.** Cada PEDIDO es local a su sucursal. Si pides otra con
`?sucursalCodigo=`, contesta **403 a propósito**: es lo que impide que un domicilio de
Camagüey vea pedidos de Santiago. Si te salen muchos `skipped` al escribir costos,
estás apuntando a la instalación equivocada.

**`vendedor` y `gestor` pueden venir `null`.** No es un fallo de la API: es un vendedor
sin gestor asignado en PEDIDO. Se arregla allí, en Vendedores.

**El domicilio es un producto de servicio.** En Ventra se llama `ENTREGA A DOMICILIO`
(código 45) y en PEDIDO ya se muestra como una línea más del pedido. Si al leer un
pedido ves esa línea, no la pidió nadie: es el propio domicilio.

**La paginación de clientes acaba cuando la página viene incompleta.** Menos filas que
el `limit` significa que no queda nada más, y entonces no viene `nextCursor`. No hace
falta una llamada extra para descubrirlo.
