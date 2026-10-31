# Oviate server

Accounts, shared candles, per-user settings / scripts, shared caches. Node 22 (runs TypeScript directly), Postgres (Neon).

- Env: `DATABASE_URL` (Neon), `SECRETS_KEY` (long random string that seals the users' API keys; Render generates it from `render.yaml`; never change it afterwards), optional `ALPACA_KEY_ID` / `ALPACA_SECRET`, `ALLOW_SIGNUP`.
- Deploy: `render.yaml` in the repository root (Render > New > Blueprint). Set `DATABASE_URL` to the Neon connection string. Tables are created on start.
- Local: `DATABASE_URL=postgres://... node src/index.ts` (port 8787), `npm test` (in-memory Postgres, no database needed).
- API (all JSON, `Authorization: Bearer <token>` except `/health`, register and login):
  `POST /api/auth/register|login|logout`, `GET /api/auth/me`, `GET /api/candles?symbol&tf&from&to`, `GET /api/search?q`,
  `GET /api/kv`, `PUT /api/kv/:key` (per user, last write wins), `GET /api/scripts`, `PUT|DELETE /api/scripts/:kind/:name` (`public: true` publishes),
  `GET /api/community?kind`, `GET /api/secrets`, `PUT|DELETE /api/secrets/:name` (API keys, sealed), `GET|PUT /api/shared/:key` (news / aisum / cal caches for everybody).
