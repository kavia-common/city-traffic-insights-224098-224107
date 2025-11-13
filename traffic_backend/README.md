# Traffic Backend

Traffic backend providing:
- GET /api/health
- GET /api/traffic/live
- GET /api/traffic/history?from&to
- GET /api/traffic/predict?horizonMinutes=15
- Swagger docs at /api/docs

Now supports MongoDB persistence via Mongoose:
- Each live snapshot is persisted as per-segment records.
- /api/traffic/history returns the last 50 records (timestamp desc) from MongoDB by default, or a filtered range if `from`/`to` is provided. Falls back to in-memory aggregation if DB is unavailable.

Supports Real Traffic (TomTom) with automatic fallback:
- If TOMTOM_API_KEY is set, /api/traffic/live uses TomTom Traffic Flow API (flowSegmentData) for the requested city (Bangalore, Mumbai, Delhi).
- If TOMTOM_API_KEY is not set or TomTom call fails, it falls back to simulated traffic data.
- API responses and query parameters remain unchanged.

Environment via .env (see .env.example). Defaults to PORT=3001.

## TomTom Setup (Optional: to enable real data)

1) Create a free TomTom Developer account and obtain an API Key for Traffic API.
2) In traffic_backend/.env, set:
   TOMTOM_API_KEY=<your-api-key>

Notes:
- We query a representative coordinate per city to respect rate limits.
- TomTom returns a single segment for the queried point; the backend normalizes and returns it in the same format as simulated data.
- Be mindful of rate limits from your TomTom plan. Consider adding caching at a gateway or reducing poll frequency on the client if needed.

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
- Copy .env.example to .env and fill MONGO_URI and (optionally) TOMTOM_API_KEY
- Do NOT commit secrets

4) Run the backend
- npm install
- npm run dev (or npm start)

Winston logs show MongoDB connection success/failure, TomTom fetch outcomes, and fallback behavior. If MONGO_URI is missing or the connection fails, the service still runs and history falls back to in-memory data.

Scripts:
- npm run dev
- npm start
