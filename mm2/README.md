<!-- Version: 2.0.0 -->
# Skyline MM2

Separate multiplayer version with:

- one shared Strait of Hormuz traffic scene per round
- server-authoritative destruction state
- boats and ships of varied sizes as strike targets
- 10 minute cooldown after every vessel is destroyed
- visible timer during cooldown
- live updates via Server-Sent Events

## Run

```bash
node mm2/server.js
```

Then open `http://localhost:3000`.

Open it in multiple tabs or browsers to verify the shared state.

## Regenerate The Current Map

If the server is already running, force a new shared round with:

```bash
curl -X POST http://127.0.0.1:3000/api/admin/regen
```

If you set `MM_ADMIN_TOKEN`, use:

```bash
curl -X POST "http://127.0.0.1:3000/api/admin/regen?token=YOUR_TOKEN"
```
