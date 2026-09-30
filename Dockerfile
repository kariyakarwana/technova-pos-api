FROM node:22.18-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
WORKDIR /app
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/technova_pos?schema=public
COPY prisma ./prisma
COPY prisma.config.ts nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:22.18-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/prisma ./prisma
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:4000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/src/main.js"]
