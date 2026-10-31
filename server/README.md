# Oviate server

Accounts, shared candles, per-user settings / scripts, shared caches. Node 22 (runs TypeScript directly), Postgres (Neon).

- Deploy: `render.yaml` in the repository root (Render > New > Blueprint). Set `DATABASE_URL` to the Neon connection string. Tables are created on start.
- Local: `DATABASE_URL=postgres://... node src/index.ts` (port 8787), `npm test` (in-memory Postgres, no database needed).
- API (all JSON, `Authorization: Bearer <token>` except `/health`, register and login):
  `POST /api/auth/register|login|logout`, `GET /api/auth/me`, `GET /api/candles?symbol&tf&from&to`, `GET /api/search?q`,
  `GET /api/kv`, `PUT /api/kv/:key` (per user, last write wins), `GET /api/scripts`, `PUT|DELETE /api/scripts/:kind/:name` (`public: true` publishes),
  `GET /api/community?kind`, `GET|PUT /api/shared/:key` (news / aisum / cal caches for everybody).
