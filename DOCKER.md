# TechNova Docker stack

The Compose stack runs the Next.js frontend, NestJS API, FastAPI AI service,
PostgreSQL, and MinIO. The AI container exposes every model router from the
single `technova-ai-service` application.

## Prerequisites

- The three repositories must be sibling folders named `technova-pos`,
  `technova-pos-api`, and `technova-ai-service`.
- Copy `.env.example` to `.env` in `technova-pos-api` and replace every secret.
- Keep the trained AI files under `technova-ai-service/artifacts` and the
  processed inference datasets under `technova-ai-service/data/processed`.
- Stop locally running services on ports 3000, 4000, 8000, 9000, and 9001.

## Start the stack

Run these commands from `technova-pos-api`:

```powershell
docker compose config
docker compose up --build -d
docker compose ps
```

The migration container applies all Prisma migrations before the backend starts.

Open:

- Frontend: <http://localhost:3000>
- Backend health: <http://localhost:4000/api/v1/health>
- AI documentation: <http://localhost:8000/docs>
- MinIO console: <http://localhost:9001>

The NestJS Swagger page is disabled while the backend runs with
`NODE_ENV=production`. Use its health endpoint above to verify the API container.

To create the initial development administrator on a new database:

```powershell
docker compose run --rm migrate npx prisma db seed
```

## Operations

```powershell
docker compose logs -f backend ai-service frontend
docker compose restart backend
docker compose down
```

Use `docker compose down -v` only when you intentionally want to delete the
PostgreSQL and MinIO development data volumes.

For a deployed environment, change browser-facing URLs and OAuth callback URLs
to HTTPS endpoints, set `AUTH_COOKIE_SECURE=true`, rotate all placeholder
secrets, and use pinned MinIO image versions or an approved object-storage
service.
