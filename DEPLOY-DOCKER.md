# Despliegue con Docker

## Requisitos
- Docker Desktop
- Docker Compose (incluido en Docker Desktop)

## Estructura recomendada
- API + PostgreSQL: usa el compose de `api`
- Frontend: usa el compose de `front`

## 1) Levantar API con PostgreSQL

```bash
cd api
docker compose up -d --build
```

Servicios:
- API: http://localhost:8400/health
- PostgreSQL: localhost:5432

Archivo usado:
- `api/docker-compose.yml`

## 2) Levantar Frontend

```bash
cd front
docker compose up -d --build
```

Servicio:
- Frontend: http://localhost:5000

Archivo usado:
- `front/docker-compose.yml`

## Comandos utiles

API:

```bash
cd api
docker compose logs -f
docker compose logs -f api
docker compose down
docker compose down -v
```

Frontend:

```bash
cd front
docker compose logs -f
docker compose down
```

## Desarrollo

Para desarrollo local se mantiene SQLite.
Usa el backend sin Docker con:

```bash
cd api
npm install
npm run dev
```

y configura en `.env` de API:

```env
DATABASE_PROVIDER=sqlite
DATABASE_URL=file:./prisma/dev.db
```
