# Skyline MM

Separate multiplayer version with:

- one shared city per round
- server-authoritative destruction state
- 10 minute cooldown after the city is fully destroyed
- visible timer during cooldown
- live updates via Server-Sent Events

## Run

```bash
node mm/server.js
```

Then open `http://localhost:3000`.

Open it in multiple tabs or browsers to verify the shared state.
