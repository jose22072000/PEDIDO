FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma.config.mjs ./
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY config.json ./config.json

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
