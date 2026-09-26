FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma.config.mjs ./
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY config.json ./config.json

# ── Un despliegue no puede quedarse con la máquina ──────────────────────────────
#
# El VPS tiene CUATRO núcleos y ahí vive todo: el Postgres de las ocho sucursales, las
# APIs, el reparto, n8n. Un `npm install` y un build se llevan los cuatro sin preguntar
# —esbuild es Go y arranca un hilo por núcleo, y npm hace lo propio—, así que durante los
# treinta segundos que dura un despliegue TODO LO DEMÁS se arrastra: las consultas de los
# vendedores, el cotejo, las tablets sincronizando.
#
# `GOMAXPROCS` le dice a esbuild cuántos puede usar. Con 2 de 4, el build tarda unos
# segundos más y la mitad de la máquina se queda libre para quien está trabajando, que es
# lo que se pidió: rápido, pero con margen para que el VPS no se caiga.
#
# Va aquí y no en un `docker build --cpus` porque quien lanza el build es Dokploy y no
# nosotros: lo que sí controlamos es lo que el build hace por dentro.
ENV GOMAXPROCS=2
ENV npm_config_jobs=2

# Generate Prisma client for production database provider.
ENV DATABASE_PROVIDER=postgresql
RUN npm install
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.mjs ./prisma.config.mjs
COPY --from=build /app/config.json ./config.json
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p uploads/temp && chmod +x docker-entrypoint.sh

EXPOSE 8400

CMD ["./docker-entrypoint.sh"]
