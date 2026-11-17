# RouteCommand

RouteCommand is a logistics and delivery platform built to demonstrate secure, real-time handling of GNSS location data. See [plan.md](./plan.md) for the full product scope and [agent.md](./agent.md) for repository conventions.

## Prerequisites

- Node.js 26 LTS and npm 11 (see `.nvmrc` and `package.json`)
- Docker Compose v2

## Start the development environment

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
docker compose up -d
npm run dev
```

The local apps and services use these default ports:

| Service              | URL / port                   |
| -------------------- | ---------------------------- |
| Web app              | http://localhost:5173        |
| API health           | http://localhost:3000/health |
| PostgreSQL + PostGIS | localhost:5432               |
| Redis                | localhost:6379               |
| Mailpit SMTP         | localhost:1025               |
| Mailpit inbox        | http://localhost:8025        |

The root Compose file starts PostGIS, Redis, and Mailpit. Its automatically loaded development override also starts the API and web app with source mounts and hot reload. For host-run development, use `docker compose -f docker-compose.yml up -d` to start only the infrastructure, then run `npm run dev`.

The database and Redis ports can be changed with `POSTGRES_PORT` and `REDIS_PORT`; the API and web ports can be changed with `API_PORT` and `WEB_PORT`. Use a local `.env` file for Compose overrides. Do not commit credentials.

## Workspace commands

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run db:migrate
npm run db:seed
npm run sim
```

Database migration and seed commands, and the telemetry simulator, are transparent placeholders until their planned phases. The test runner is configured and will discover tests as they are added.

## Project status

See [docs/PROGRESS.md](./docs/PROGRESS.md) for the current phase, completed work, and next action.
