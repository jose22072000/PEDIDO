FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

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

COPY package.json ./
RUN npm install

COPY . .

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

FROM nginx:1.27-alpine AS runtime
WORKDIR /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist ./

EXPOSE 5000

CMD ["nginx", "-g", "daemon off;"]
