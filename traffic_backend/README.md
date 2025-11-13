# Traffic Backend

Simulated traffic backend providing:
- GET /api/health
- GET /api/traffic/live
- GET /api/traffic/history?from&to
- GET /api/traffic/predict?horizonMinutes=15
- Swagger docs at /api/docs

Now supports MongoDB persistence via Mongoose:
- Each simulated live snapshot is persisted as per-segment records.
- /api/traffic/history returns the last 50 records (timestamp desc) from MongoDB by default, or a filtered range if `from`/`to` is provided. Falls back to in-memory aggregation if DB is unavailable.

Environment via .env (see .env.example). Defaults to PORT=3001.

## MongoDB Setup

1) Create a MongoDB database
- Local: install MongoDB and start it on mongodb://localhost:27017
- Atlas: create a free cluster at https://www.mongodb.com/atlas

2) Get your connection string (MONGO_URI)
- Atlas example:
  mongodb+srv://<USER>:<PASSWORD>@<CLUSTER>.mongodb.net/traffic?retryWrites=true&w=majority
- Local example:
  mongodb://localhost:27017/traffic

3) Set MONGO_URI in traffic_backend/.env
- Copy .env.example to .env and fill MONGO_URI
- Do NOT commit secrets

4) Run the backend
- npm install
- npm run dev (or npm start)

Winston logs show MongoDB connection success/failure. If MONGO_URI is missing or the connection fails, the service still runs and history falls back to in-memory data.

Scripts:
- npm run dev
- npm start
