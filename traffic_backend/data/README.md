This folder stores small rolling JSON files for local persistence when MongoDB is not configured.

Files:
- local_traffic_<city>.json: recent snapshots (truncated to last ~1200 entries) for the specified city.

Note: These files are created at runtime; safe to delete between sessions.
