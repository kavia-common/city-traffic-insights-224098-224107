# Traffic Backend

Simulated traffic backend providing:
- GET /api/health
- GET /api/traffic/live
- GET /api/traffic/history?from&to
- GET /api/traffic/predict?horizonMinutes=15
- Swagger docs at /api/docs

Environment via .env (see .env.example). Defaults to PORT=3001.

Scripts:
- npm run dev
- npm start
