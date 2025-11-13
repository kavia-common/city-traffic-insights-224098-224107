# Traffic Backend

Backend service providing simulated or real (TomTom) traffic snapshots, history with optional MongoDB persistence, and short-term predictions.

Endpoints:
- GET /api/health
- GET /api/traffic/live
  - Always includes "incidents": [] (reserved for future use)
- GET /api/traffic/history?from&to&format&city
  - Supports format=points to return a simplified points array for charting
- GET /api/traffic/predict?horizonMinutes=15&city
- Swagger docs at /api/docs

When TOMTOM_API_KEY is set, /api/traffic/live fetches TomTom Traffic Flow (flowSegmentData) for the selected city (Bangalore, Mumbai, Delhi). On failure or when not configured, it falls back to simulated data. API response shapes and query params remain the same.

MongoDB persistence (via Mongoose) or JSON fallback:
- Best-effort persistence of each live snapshot to per-segment records.
- /api/traffic/history defaults to last 60 minutes if no range specified, or filters by `from`/`to` ISO timestamps.
- If DB is unavailable or MONGO_URI not set, falls back to in-memory aggregation plus local JSON store (data/local_traffic_<city>.json).

Environment configuration is via .env (see .env.example). Defaults to PORT=3001.

--------------------------------------------------------------------------------
Quickstart
--------------------------------------------------------------------------------
1) Copy environment
   cp .env.example .env
   - Set REACT_APP_FRONTEND_URL to your frontend URL (e.g., http://localhost:3000)
   - Optionally set MONGO_URI for persistence
   - Optionally set TOMTOM_API_KEY to enable real traffic data

2) Install and run
   npm install
   npm run dev   # hot-reload with nodemon
   # or
   npm start     # production-like

3) Open docs
   http://localhost:3001/api/docs

--------------------------------------------------------------------------------
Environment variables (back-end)
--------------------------------------------------------------------------------
These are the key vars consumed by the backend. See .env.example for comments.

Required for local dev:
- PORT: Port to run the backend (defaults to 3001)
- REACT_APP_FRONTEND_URL: Allowed origin for CORS (e.g., http://localhost:3000)

Optional but recommended:
- MONGO_URI: MongoDB connection string for persistence
  - Atlas: mongodb+srv://<USER>:<PASSWORD>@<CLUSTER>.mongodb.net/traffic?retryWrites=true&w=majority
  - Local: mongodb://localhost:27017/traffic
- TOMTOM_API_KEY: Enables real-time data for /api/traffic/live

Other optional vars respected by config:
- NODE_ENV, REACT_APP_NODE_ENV
- REACT_APP_TRUST_PROXY (default true)
- REACT_APP_LOG_LEVEL (debug/info/warn/error)
- REACT_APP_HEALTHCHECK_PATH (/api/health)
- REACT_APP_API_BASE, REACT_APP_BACKEND_URL, REACT_APP_WS_URL (informational)
- REACT_APP_FEATURE_FLAGS, REACT_APP_EXPERIMENTS_ENABLED

Note: Never commit your real .env. Use .env.example as a template.

--------------------------------------------------------------------------------
MongoDB Atlas setup (persistence)
--------------------------------------------------------------------------------
1) Create an Atlas account and cluster (Free tier is fine)
   https://www.mongodb.com/atlas

2) Create a Database User
   - Username/password with Read/Write permissions for your cluster

3) Network access
   - Allow your IP or 0.0.0.0/0 for quick local testing (not recommended for production)

4) Get your connection string
   - Example:
     mongodb+srv://<USER>:<PASSWORD>@<CLUSTER>.mongodb.net/traffic?retryWrites=true&w=majority

5) Set MONGO_URI in .env
   MONGO_URI=mongodb+srv://<USER>:<PASSWORD>@<CLUSTER>.mongodb.net/traffic?retryWrites=true&w=majority

6) Start backend; logs will show "MongoDB connected" if successful.
   - If it fails or MONGO_URI is unset, the app still runs using in-memory history.

--------------------------------------------------------------------------------
TomTom API setup (real-time live data)
--------------------------------------------------------------------------------
1) Create a TomTom Developer account and obtain an API key
   https://developer.tomtom.com/

2) Ensure the Traffic Flow API is enabled for your key.

3) Set TOMTOM_API_KEY in .env
   TOMTOM_API_KEY=your_api_key_here

4) Start backend; the live endpoint will source TomTom.
   - On any upstream error or rate limit, the backend automatically falls back to simulated data.

Notes:
- One representative coordinate per supported city is used to respect rate limits.
- The API normalizes TomTom response into our standard features format.

--------------------------------------------------------------------------------
Deployments (Render / Railway)
--------------------------------------------------------------------------------

Render (Web Service):
1) Create a new Web Service and point it to city-traffic-insights-224098-224107/traffic_backend
2) Build command: npm install
3) Start command: npm start
4) Health Check Path: /api/health
5) Environment variables:
   - REACT_APP_FRONTEND_URL=https://your-frontend.vercel.app
   - MONGO_URI=your Atlas connection string (optional)
   - TOMTOM_API_KEY=your tomtom key (optional)
   - REACT_APP_TRUST_PROXY=true
   - REACT_APP_LOG_LEVEL=info
6) Deploy, then verify /api/health and /api/docs

Railway (Service):
1) Create a new Service from the repo; set working directory to city-traffic-insights-224098-224107/traffic_backend
2) Start command: npm start
3) Healthcheck path: /api/health
4) Environment variables same as above
5) Deploy and verify

CORS with Vercel frontend:
- Set REACT_APP_FRONTEND_URL in this service to your Vercel domain precisely, e.g. https://your-project.vercel.app

--------------------------------------------------------------------------------
Troubleshooting
--------------------------------------------------------------------------------
CORS errors in browser (blocked by CORS):
- Ensure REACT_APP_FRONTEND_URL in backend .env matches your frontend URL exactly (scheme, host, port).
- For local dev: REACT_APP_FRONTEND_URL=http://localhost:3000
- Restart backend after changing .env.
- The backend allows localhost/127.0.0.1 origins for convenience.

Cannot connect to MongoDB:
- Verify MONGO_URI is set and correct.
- For Atlas:
  - Make sure your IP is allowed in Network Access.
  - Confirm database user credentials and permissions.
- Check backend logs for:
  - "MONGO_URI not provided" → set it in .env
  - "MongoDB connection failed" → verify URI, credentials, and network.

TomTom 401/403 or upstream errors:
- 401 Unauthorized → Verify TOMTOM_API_KEY value and API access for Traffic Flow.
- 403 Forbidden → Key may lack permissions or exceeded quota.
- Backend will log "TomTom fetch failed" and fall back to simulated data.
- You can temporarily unset TOMTOM_API_KEY to force simulation while diagnosing.

Port conflicts / server not starting:
- Change PORT in .env (e.g., 3002) if 3001 is in use.
- Ensure nothing else is listening on that port.

--------------------------------------------------------------------------------
Scripts
--------------------------------------------------------------------------------
- npm run dev   # Start with nodemon (development)
- npm start     # Start with node (production-like)
- npm run lint  # Lint code
- npm run openapi:generate # Regenerate interfaces/openapi.json

--------------------------------------------------------------------------------
Security & Notes
--------------------------------------------------------------------------------
- Do NOT commit secrets (.env). Only .env.example belongs in git.
- Logs are structured via winston; secrets are not logged.
- Rate limiting and security headers are enabled out of the box.

