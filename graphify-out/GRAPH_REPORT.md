# Graph Report - /home/jose/procovar/PEDIDO  (2026-07-26)

## Corpus Check
- 151 files · ~76,426 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 931 nodes · 1351 edges · 126 communities (55 shown, 71 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 86 edges (avg confidence: 0.64)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Api Src Routes
- Front Domain
- Front
- Api Src Lib
- Package Dependencies
- Package
- Front Pedidos Order
- Front
- Front Reportes Pedidos
- Front Tsconfig Compileroptions
- Front
- Front
- Front Icons
- Front Configuracion
- Import Geolocalizacion
- Tsconfig Compileroptions
- Docker Dev
- Docker Compose
- Vps Docker Compose
- Front Package Devdependencies
- Crear Gestores Cam
- Local Local
- Windows
- Vps Vps
- Front Package
- Tsconfig Node Compileroptions
- Sqlite To Postgres
- Front Package Dependencies
- Migrations 20251206210555 Initial
- Front Images Bg
- Front Layouts
- Export All
- Import All
- Prisma Seed Mjs
- Front Steps Stepcardswithprogress
- Front Usuarios Nuevo
- Handoff Delivery Events
- Merge Vendedores
- Recompute Vendedor Codigos
- Local Local
- Front Provider
- Front Reportes Pedidos
- Prisma Seed Ts
- Front Generate Icons
- Migrations 20260527195000 Scope
- Front Eslint Config
- Local Local
- Docker Entrypoint
- Prisma Config
- Migrations 20251206211105 Update
- Migrations 20260111161958 Add
- Migrations 20260508150844 Add
- Migrations 20260707000000 Add
- Migrations 20260707010000 Add
- Migrations 20260707020000 Add
- Migrations 20260707210000 Vendedor
- Migrations 20260707220000 Vendedor
- Eslint
- Eslint Compat
- Eslint Eslintrc
- Eslint Js
- Eslint Plugin Import
- Eslint Plugin Jsx
- Eslint Plugin Node
- Eslint Plugin Prettier
- Eslint Plugin React
- Eslint Plugin React
- Eslint Plugin Unused
- Framer Motion
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package Dependencies
- Front Package
- Front Package
- Front Package Dependencies
- Front Package Devdependencies
- Front Package
- Front Package Devdependencies
- Front Package Devdependencies
- Front Package Devdependencies
- Front Package
- Front Package Devdependencies
- Front Package Devdependencies
- Front Package Devdependencies
- Front Package Devdependencies
- Front Package Devdependencies
- Front Package Devdependencies
- Front Config Site
- Front Vercel
- Handoff Import Use
- Handoff Sse Ticket
- Handoff Sudo Whitelist

## God Nodes (most connected - your core abstractions)
1. `getApiBaseUrl()` - 34 edges
2. `useAuthStore` - 29 edges
3. `Icons` - 18 edges
4. `compilerOptions` - 17 edges
5. `getRequesterContext()` - 15 edges
6. `NavigationHeading()` - 15 edges
7. `cards` - 15 edges
8. `createPrismaClient()` - 10 edges
9. `resolveSucursalScope()` - 10 edges
10. `compilerOptions` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Guía de Despliegue en Windows (Procavar Pedidos)` --semantically_similar_to--> `Modelo LOCAL por sucursal (Windows + PM2, sin nube)`  [INFERRED] [semantically similar]
  DEPLOY-WINDOWS.md → deploy/local/DEPLOY-LOCAL.md
- `servicio api (procovar-api, :8400)` --semantically_similar_to--> `servicio pedido-api (Express + Prisma 7, :8400)`  [INFERRED] [semantically similar]
  api/docker-compose.yml → deploy/vps/docker-compose.yml
- `servicio pedido-front (Vite → nginx :5000, VITE_API_BASE_URL=/api)` --semantically_similar_to--> `servicio front (procovar-front, host 5001→5000)`  [INFERRED] [semantically similar]
  deploy/vps/docker-compose.yml → front/docker-compose.yml
- `BUILD_STANDALONE=1 obligatorio en el build de DELIVERY` --semantically_similar_to--> `Build normal bajo PM2 (evitar warning de output: standalone)`  [INFERRED] [semantically similar]
  HANDOFF.md → deploy/local/DEPLOY-LOCAL.md
- `BUILD_STANDALONE=1 obligatorio en el build de DELIVERY` --conceptually_related_to--> `servicio delivery (Next standalone :3000)`  [INFERRED]
  HANDOFF.md → deploy/vps/docker-compose.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Cutover event-driven PEDIDO→DELIVERY (enqueue, gate, red de seguridad, Redis en el host)** — handoff_event_driven_no_polling, handoff_enqueue_delivery_orders, handoff_delivery_events_flag, handoff_safety_poll, handoff_redis_published_to_host, handoff_make_queue_generic [EXTRACTED 1.00]
- **Stack de producción del VPS (3 apps sobre Postgres+Redis tras Caddy)** — deploy_vps_docker_compose_postgres, deploy_vps_docker_compose_redis, deploy_vps_docker_compose_pedido_api, deploy_vps_docker_compose_pedido_front, deploy_vps_docker_compose_delivery, deploy_vps_docker_compose_delivery_sync, deploy_vps_docker_compose_analitics_api, deploy_vps_docker_compose_analitics_front, deploy_vps_docker_compose_caddy [EXTRACTED 1.00]
- **PEDIDO Frontend Static Visual Asset Set (branding + decorative backgrounds)** — front_public_images_bg_left_background_blob_left, front_public_images_bg_right_background_blob_right, front_public_pwa_192x192_pwa_icon_192, front_public_pwa_512x512_pwa_icon_512, front_src_components_images_logo_procovar_wordmark [INFERRED 0.75]
- **PWA Installability Icon Set (192px + 512px manifest icons)** — front_public_pwa_192x192_pwa_icon_192, front_public_pwa_512x512_pwa_icon_512, front_public_pwa_512x512_procovar_brand_identity [INFERRED 0.85]
- **Procovar VA Monogram Asset Family (PWA icons + in-app logos)** — front_public_pwa_192x192_pwa_icon_192, front_public_pwa_512x512_pwa_icon_512, front_src_components_images_logo___copia_logo_monogram_copy, front_src_components_images_logo_procovar_wordmark [INFERRED 0.85]

## Communities (126 total, 71 thin omitted)

### Community 0 - "Api Src Routes"
Cohesion: 0.06
Nodes (46): app, upload, archivarPedidos(), iniciarArchivadoAutomatico(), getRequesterContext(), parseBearerToken(), RequesterContext, requireSucursalId() (+38 more)

### Community 2 - "Front Domain"
Cohesion: 0.05
Nodes (36): Otp, OtpSchema, SesionLocal, SesionLocalSchema, Categoria, CategoriaSchema, Grupo, GrupoSchema (+28 more)

### Community 3 - "Front"
Cohesion: 0.07
Nodes (30): react, ActionCard, ActionCardProps, ChartCardProps, chartConfig, MonthlyStats, MONTHS, KPICard() (+22 more)

### Community 4 - "Api Src Lib"
Cohesion: 0.09
Nodes (33): ClientDto, mapCsvRecords(), mapCsvToOrderRecord(), OrderDto, OrderItemDto, OrderRecordDto, SellerDto, deliveryOrdersQueue() (+25 more)

### Community 5 - "Package Dependencies"
Cohesion: 0.05
Nodes (39): dependencies, bcryptjs, better-sqlite3, bull, cookie-parser, cors, csv-parse, dotenv (+31 more)

### Community 6 - "Package"
Cohesion: 0.06
Nodes (35): devDependencies, @prisma/internals, ts-node-dev, @types/bcryptjs, @types/better-sqlite3, @types/cookie-parser, @types/cors, @types/express (+27 more)

### Community 7 - "Front Pedidos Order"
Cohesion: 0.10
Nodes (26): Cliente, ClientesList(), ClientesResponse, PaginationData, Cliente, domicilioOptions, estadoColors, estadoLabels (+18 more)

### Community 8 - "Front"
Cohesion: 0.14
Nodes (23): Operacion, OperacionEnum, SyncFailed, SyncFailedSchema, SyncQueue, SyncQueueSchema, SyncState, SyncStateSchema (+15 more)

### Community 9 - "Front Reportes Pedidos"
Cohesion: 0.11
Nodes (19): ReportePedidosEstadoPage(), Pedido, PedidoItem, ReportePedidosFechaPage(), Resumen, Sucursal, Pedido, PedidoItem (+11 more)

### Community 10 - "Front Tsconfig Compileroptions"
Cohesion: 0.08
Nodes (23): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+15 more)

### Community 11 - "Front"
Cohesion: 0.16
Nodes (9): Icons, NavigationHeading(), getSucursalActiva(), Sucursal, SucursalSelector(), Rol, Sucursal, Usuario (+1 more)

### Community 12 - "Front"
Cohesion: 0.23
Nodes (11): App(), AdminRoute(), AdminRouteProps, ProtectedRoute(), useAuthGuard(), LoginFormData, LoginPage(), loginSchema (+3 more)

### Community 13 - "Front Icons"
Cohesion: 0.16
Nodes (5): Logo(), MoonFilledIcon(), SunFilledIcon(), ThemeSwitchProps, IconSvgProps

### Community 14 - "Front Configuracion"
Cohesion: 0.26
Nodes (8): ConfiguracionForm(), MantenimientoPanel(), Vendedor, CrearPedidoForm(), fileTypes, openImportStream(), ANIMATIONS, getApiBaseUrl()

### Community 15 - "Import Geolocalizacion"
Cohesion: 0.23
Nodes (11): CODE_ARG, __dirname, enrichSucursal(), FILE, main(), norm(), parseGeo(), prisma (+3 more)

### Community 16 - "Tsconfig Compileroptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, outDir, resolveJsonModule, rootDir, skipLibCheck, strict (+3 more)

### Community 17 - "Docker Dev"
Cohesion: 0.18
Nodes (12): Desarrollo local con SQLite (DATABASE_PROVIDER=sqlite), Prisma 7 con driver adapter (prisma-node-client.mjs), Migración SQLite→Postgres con export-all.mjs / import-all.mjs, Backfill de sucursalId antes de importar geo, Cola geo-import (consolidado de geolocalización), Respaldo de la base SQLite (service-api/prisma/dev.db), Mirror de clientes PEDIDO→DELIVERY, CustomerPicker en PedidoForm (routes/page.tsx) (+4 more)

### Community 18 - "Docker Compose"
Cohesion: 0.22
Nodes (11): servicio api (procovar-api, :8400), servicio postgres (procovar-postgres, 5433:5432), Despliegue con Docker (PEDIDO), web.config rewrite para rutas React en IIS, Cambio de puerto de API exige recompilar el front, servicio front (procovar-front, host 5001→5000), Shell SPA de PROCOVAR (index.html, /src/main.tsx), PROCOVAR — Handoff de contexto (+3 more)

### Community 19 - "Vps Docker Compose"
Cohesion: 0.33
Nodes (11): Layout vps-deploy/ con los 3 repos como hermanos, Bundle real (sync-queue.mjs) vs upgrade futuro a BullMQ, servicio analitics-api (FastAPI, alias de red backend), servicio analitics-front (Vite → nginx :80), servicio caddy (reverse proxy TLS automático), servicio delivery (Next standalone :3000), servicio delivery-sync (worker Dockerfile.worker), servicio pedido-api (Express + Prisma 7, :8400) (+3 more)

### Community 20 - "Front Package Devdependencies"
Cohesion: 0.18
Nodes (11): eslint-config-prettier, devDependencies, eslint-config-prettier, globals, prettier, sharp, @typescript-eslint/eslint-plugin, globals (+3 more)

### Community 21 - "Crear Gestores Cam"
Cohesion: 0.29
Nodes (8): createPrismaClient(), getSqlitePathFromUrl(), rawProvider, shouldUseSqliteAdapter(), CODIGO, firstName(), main(), prisma

### Community 22 - "Local Local"
Cohesion: 0.24
Nodes (9): Guard de configuración (fórmula + punto de partida), Flujo de costo de domicilio (pull → cotiza → writeback), Tabla SyncJob como "redis sin redis", Data Warehouse de pesos (10.188.2.2:3001, read-only por VPN), VPN WireGuard por sucursal (túnel al warehouse), Cola domicilios (BullMQ, reemplaza el polling de SyncJob), Cache en Redis (pesos del warehouse y reportes pesados), Colas out:* (Slice 3) diferidas a propósito (+1 more)

### Community 23 - "Windows"
Cohesion: 0.22
Nodes (10): config.json con el sucursalId REAL de esta instalación, Modelo LOCAL por sucursal (Windows + PM2, sin nube), Dos formas de despliegue (LOCAL vs VPS), Modelo CENTRALIZADO en la nube (VPS, producción real), Cutover a centralizado (consolidar históricos sin perder datos), Cola db-restore (restaurar backup de otro server), PM2 ecosystem.config.js (procavar-api / procavar-frontend), setup-windows-service.bat (instalación automática) (+2 more)

### Community 24 - "Vps Vps"
Cohesion: 0.29
Nodes (10): Concurrencia acotada (IMPORT_CONCURRENCY, limiter de BullMQ), Reverse proxy sin buffering para SSE (flush_interval -1), Refactor a src/lib/importCore.ts (endpoint y worker comparten lógica), Cola import-csv (POST /orders/bulk responde 202 + jobId), Checklist "no colapsa", src/lib/queues.ts (import-csv, geo-import, db-restore, domicilios), src/lib/redis.ts (connection + pub/sub duplicados), SSE de pedidos por Redis Pub/Sub (canal orders:new) (+2 more)

### Community 25 - "Front Package"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, lint, start, type (+1 more)

### Community 26 - "Tsconfig Node Compileroptions"
Cohesion: 0.20
Nodes (9): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, strict, include (+1 more)

### Community 27 - "Sqlite To Postgres"
Cohesion: 0.31
Nodes (7): arg(), Database, DRY, fecha(), main(), prisma, require

### Community 28 - "Front Package Dependencies"
Cohesion: 0.22
Nodes (9): clsx, dependencies, clsx, @heroui/code, react-drag-drop-files, recharts, @heroui/code, react-drag-drop-files (+1 more)

### Community 29 - "Migrations 20251206210555 Initial"
Cohesion: 0.43
Nodes (7): "Client", "Order", "OrderItem", "Roles", "Seller", "Sucursal", "User"

### Community 30 - "Front Images Bg"
Cohesion: 0.43
Nodes (8): bg-left.png - Left Decorative Gradient Blob, Soft Pastel Gradient Background Aesthetic (Blue/Violet Blur Blobs), bg-right.png - Right Decorative Gradient Blob, pwa-192x192.png - PWA App Icon (192px), Procovar Brand Identity (VA Monogram, Deep Navy Blue), pwa-512x512.png - PWA App Icon (512px), logo - copia.png - Procovar Monogram Only (Duplicate Asset), logo.png - PROCOVAR Wordmark + Monogram Logo

### Community 31 - "Front Layouts"
Cohesion: 0.36
Nodes (3): PageBackground(), DefaultLayout(), PanelLayout()

### Community 32 - "Export All"
Cohesion: 0.29
Nodes (4): __dirname, OUT, prisma, stamp

### Community 33 - "Import All"
Cohesion: 0.33
Nodes (5): __dirname, IN, main(), prisma, upsertAll()

### Community 34 - "Prisma Seed Mjs"
Cohesion: 0.38
Nodes (5): createPrismaClient(), getSqlitePathFromUrl(), rawProvider, shouldUseSqliteAdapter(), prisma

### Community 35 - "Front Steps Stepcardswithprogress"
Cohesion: 0.33
Nodes (4): Props, StepCard(), Props, Step

### Community 36 - "Front Usuarios Nuevo"
Cohesion: 0.33
Nodes (4): NuevoUsuarioForm(), Rol, Sucursal, UsuarioFormData

### Community 37 - "Handoff Delivery Events"
Cohesion: 0.29
Nodes (7): Gate DELIVERY_EVENTS (despliegue inerte + rollback), Dockerizar delivery (opcional, systemd→docker), enqueueDeliveryOrders() → cola procovar-delivery:in:orders, Arquitectura event-driven (sin polling) con colas in/out, makeQueue() genérico + deliveryOrdersQueue() en queues.ts, procovar-redis publicado en 127.0.0.1:6379 para delivery nativo, SAFETY_POLL_MS (red de seguridad lenta, default 5min)

### Community 38 - "Merge Vendedores"
Cohesion: 0.47
Nodes (5): arg(), DRY, findVendedor(), main(), prisma

### Community 39 - "Recompute Vendedor Codigos"
Cohesion: 0.47
Nodes (5): DRY, main(), prisma, sellerCode(), sinTildes()

### Community 40 - "Local Local"
Cohesion: 0.33
Nodes (6): Worker procovar-delivery-sync debe estar online, Next bajo PM2 no carga .env (set -a; . ./.env; set +a), pm2 save tras añadir procesos, SUCURSAL_CODIGO (scoping del worker por sucursal), Aislamiento por sucursal (usuario vs Super Admin), Rol Supervisor con vendedores + isGlobalAdmin consistente

### Community 41 - "Front Provider"
Cohesion: 0.40
Nodes (4): _origFetch, Provider(), @react-types/shared, RouterConfig

### Community 42 - "Front Reportes Pedidos"
Cohesion: 0.33
Nodes (5): Pedido, PedidoItem, Resumen, Sucursal, Vendedor

### Community 44 - "Front Generate Icons"
Cohesion: 0.40
Nodes (3): __dirname, __filename, publicDir

### Community 45 - "Migrations 20260527195000 Scope"
Cohesion: 0.50
Nodes (3): "Client", "Order", "Seller"

### Community 46 - "Front Eslint Config"
Cohesion: 0.50
Nodes (3): compat, __dirname, __filename

### Community 49 - "Local Local"
Cohesion: 0.67
Nodes (3): delivery se queda en Postgres (campos Json), Build normal bajo PM2 (evitar warning de output: standalone), BUILD_STANDALONE=1 obligatorio en el build de DELIVERY

## Ambiguous Edges - Review These
- `Soft Pastel Gradient Background Aesthetic (Blue/Violet Blur Blobs)` → `Procovar Brand Identity (VA Monogram, Deep Navy Blue)`  [AMBIGUOUS]
  front/public/images/bg-left.png · relation: conceptually_related_to

## Knowledge Gaps
- **351 isolated node(s):** `require`, `prisma`, `DRY`, `docker-entrypoint.sh script`, `prisma` (+346 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **71 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Soft Pastel Gradient Background Aesthetic (Blue/Violet Blur Blobs)` and `Procovar Brand Identity (VA Monogram, Deep Navy Blue)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `dependencies` connect `Front Package Dependencies` to `Front`, `Front Package`, `Framer Motion`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package Dependencies`, `Front Package`, `Front Package`, `Front Package Dependencies`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Why does `react` connect `Front` to `Front Package Dependencies`, `Front`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Why does `LoginPage()` connect `Front` to `Front`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **What connects `require`, `prisma`, `DRY` to the rest of the system?**
  _351 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Api Src Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.057971014492753624 - nodes in this community are weakly interconnected._
- **Should `Front Icons Iconify` be split into smaller, more focused modules?**
  _Cohesion score 0.03571428571428571 - nodes in this community are weakly interconnected._