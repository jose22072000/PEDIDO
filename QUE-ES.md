# PEDIDO — qué es y cómo encaja

**El sistema principal.** Gestiona los pedidos de las 8 sucursales: quién los
levanta, a qué cliente, con qué productos y en qué estado están.

Es el **origen de la verdad** de pedidos, clientes y vendedores. Los otros
proyectos leen de aquí, no al revés.

---

## Partes

| | Qué es | Dónde corre |
|---|---|---|
| `api/` | Express + Prisma + PostgreSQL. 69 endpoints. | `pedidos.procovar.cloud/api` |
| `front/` | React + Vite (SPA, es también PWA). | `pedidos.procovar.cloud` |
| `api/src/worker.ts` | Procesa la cola de importación de CSV. | servicio aparte, sin dominio |

Rama de despliegue: **`dev`**.

---

## Quién consume a PEDIDO

- **delivery** — pide los clientes geolocalizados y los pedidos que necesitan
  costo de domicilio, vía `/integration/*` con `x-api-key`.
- **n8n** — sube los CSV de ventas de cada sucursal a `POST /orders/bulk`.
- **Julian (externo)** — usa una api-key propia (`pk_e7004bede…`, etiqueta
  `julian`) contra `/integration/*`.
- **analitics** — consulta conteos de pedidos por cliente (opcional; si no está
  configurado, esa columna simplemente no aparece).

## De qué depende PEDIDO

- **PostgreSQL** — base `procovar_pedidos`.
- **Redis** — dos cosas: eventos en vivo (SSE) y la cola de importación.
  Es **opcional**: sin `REDIS_URL` el SSE cae a sondeo y la importación se hace
  dentro de la petición.
- **Parranda (Retool)** — enriquece los clientes con geolocalización. Solo
  enriquece, **no crea** clientes.

---

## Cosas que hay que saber

**El SSE.** Hay un canal genérico `/events/stream`: cuando algo cambia, la API
publica un evento y las vistas abiertas se refrescan solas. Las entidades que
avisan son pedido, cliente, usuario, vendedor y apikey. Si añades una operación
que modifica datos, tiene que emitir su evento o la pantalla del otro usuario se
queda desactualizada.

**`config.json`.** Define de qué sucursal es esta instalación. En `null` = central,
ve todas. Si se pone un id de sucursal, `/integration/*` se acota a ella. Un id
equivocado deja esos endpoints devolviendo cero, y como delivery borra de su
espejo lo que no venga en la respuesta, se puede llevar por delante los 5380
clientes. Ya pasó.

**Índices.** `OrderItem.orderId` y `Order.sellerId` son imprescindibles: sin
ellos cada consulta que trae items recorre la tabla entera. Van declarados en
`schema.prisma` — un índice creado a mano en la base lo borra `prisma db push`
en el siguiente despliegue.

**PWA.** El service worker está en `skipWaiting + clientsClaim`, así que un
despliegue nuevo entra al primer refresco. Antes se quedaba "en espera" y los
usuarios seguían viendo JS viejo: era la causa de "arreglaste esto y sigue
igual".

---

## Documentación relacionada

- `DOKPLOY-NUEVO-PROYECTO.md` (raíz) — cómo se despliega
- `REDIS-ROLLOUT.md` (raíz) — cómo se activa Redis por partes
- `deploy/vps/DEPLOY-VPS.md` — arquitectura de la instalación
