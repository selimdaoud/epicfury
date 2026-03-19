<!-- Version: 1.0.2 -->
# Skyline MM V2 Architecture

## Goal

Design a multiplayer architecture for `Skyline MM` that can support:

- very large numbers of concurrent users
- a larger city map
- shared real-time destruction state
- predictable round lifecycle
- resilience across process restarts and network issues

This document is design-only. It does not prescribe implementation details beyond the architectural level.

## Executive Summary

The current `mm/server.js` model is a single-process MVP. It owns all game state in memory, broadcasts directly to every client, and persists state to one local file. That is acceptable for prototyping, but it does not scale.

V2 should move to an event-driven, horizontally scalable architecture with:

- stateless app nodes that handle both client connections and command intake
- one shared authoritative hot-state system
- explicit strike lifecycle events
- snapshot + live-stream synchronization
- larger-map support without over-streaming geometry

The core design principle is:

`clients render locally, servers authorize centrally, state is shared through durable infrastructure`

## Primary Requirements

### Functional

- One shared city per round
- Same destruction state for all users
- Round ends when all required buildings are destroyed
- Cooldown timer is globally consistent
- New round creates a fresh map
- Missile and interceptor animations are visible to all users
- Larger map than current MVP

### Non-Functional

- Support very high concurrent connection count
- Avoid single-process bottlenecks
- Tolerate node restarts without corrupting the round
- Support deploys without losing the whole game
- Minimize duplicate or replayed animations
- Keep bandwidth low enough for mass spectators

## High-Level Topology

The most elegant large-scale V2 is a four-part system:

1. Edge proxy layer
2. Stateless app node layer
3. Redis authority layer
4. Worker layer

## Architecture Layer Diagram

```text
┌───────────────────────────────────────────────────────────────┐
│                        Client Layer                           │
│  Browsers / Three.js clients                                 │
│  - render city locally                                       │
│  - play missile/interceptor animations locally               │
│  - send strike requests                                      │
│  - receive snapshots and live events                         │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                │ WebSocket / HTTPS
                                │
┌───────────────────────────────▼───────────────────────────────┐
│                        Edge Layer                             │
│  Load balancer / Nginx / HAProxy                             │
│  - TLS termination                                            │
│  - connection routing                                         │
│  - rate limiting                                              │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                │
┌───────────────────────────────▼───────────────────────────────┐
│                    Stateless App Node Layer                  │
│  Node.js app instances                                        │
│  - accept WebSocket clients                                   │
│  - serve bootstrap snapshots                                  │
│  - validate incoming commands                                 │
│  - publish and consume live events                            │
│  - never own authoritative state locally                      │
└───────────────┬───────────────────────────────┬───────────────┘
                │                               │
                │ read/write state              │ publish/consume events
                │                               │
┌───────────────▼───────────────┐   ┌──────────▼────────────────┐
│     Redis Authority Layer     │   │        Worker Layer       │
│  - active round state         │   │  background worker nodes  │
│  - building destruction state │   │  - resolve due strikes    │
│  - active strike locks        │   │  - start cooldown         │
│  - leaderboard counters       │   │  - generate/reset rounds  │
│  - pub/sub event channels     │   │  - publish round events   │
└───────────────────────────────┘   └──────────┬───────────────┘
                                               │
                                               │ optional later
                                               │
                                   ┌───────────▼───────────────┐
                                   │ Optional Durable Storage  │
                                   │  Postgres                  │
                                   │  - round history           │
                                   │  - analytics               │
                                   │  - moderation/audit        │
                                   └────────────────────────────┘
```

### 1. Edge Proxy Layer

Role:

- terminates TLS
- load balances client traffic
- forwards long-lived real-time connections
- enforces basic rate limiting and abuse controls

Suitable technologies:

- Nginx
- HAProxy
- cloud load balancer

This layer must support long-lived streaming connections cleanly. WebSocket is preferable for V2, though SSE can remain acceptable if the rest of the stack is controlled carefully.

### 2. Stateless App Node Layer

Role:

- maintains client connections
- accepts gameplay commands
- identifies players
- subscribes to shared game events
- pushes live events to clients
- serves current snapshots on connect or reconnect

Important property:

- app nodes must be stateless with respect to authoritative game state

That means any app node should be able to accept any client. If a node dies, clients reconnect elsewhere and recover from snapshot + live events.

This design intentionally does not split "gateway" and "command API" into separate services at first. That split adds complexity without giving enough value for this game until traffic is much larger.

### 3. Redis Authority Layer

Role:

- stores round metadata
- stores building destruction state
- stores active strikes
- stores leaderboard counters
- stores cooldown timers
- distributes events to app nodes

Redis should be the single hot-path backbone for V2:

- state store
- lock manager
- scheduler metadata
- event fan-out

This is the main simplification from the earlier proposal. A separate event-bus product is not necessary initially. Redis is enough if the data model is disciplined.

### 4. Worker Layer

Role:

- starts new rounds
- resolves strikes at impact time
- advances cooldown state
- generates new maps
- computes large background aggregates

This layer runs as separate worker processes, but it can share the same codebase as app nodes and simply start in a different role.

## Minimal Recommended Stack

The cleanest V2 stack is:

- edge proxy or cloud load balancer
- Node.js app nodes with WebSocket
- Redis
- worker processes

Postgres should be optional, not required for the first scalable version.

Add Postgres only if one of these becomes important:

- persistent round history
- long-term player accounts
- analytics and reporting
- moderation and audit retention

This keeps the system much smaller operationally while still scaling far beyond the current MVP.

## Recommended Core Model

V2 should separate the system into:

- snapshot state
- command requests
- domain events

### Snapshot State

Snapshot state is what is true now.

It should include:

- `roundId`
- `mapId`
- `phase`
- `cooldownEndsAt`
- `remainingBuildings`
- `totalBuildings`
- building destruction flags or compact destruction encoding
- leaderboard summary

It should not include transient replay-oriented fields like "last event" unless explicitly needed for recovery.

### Command Requests

Examples:

- `strike_request`
- `register_player`
- `rename_player`

These are inbound client intentions, not facts.

### Domain Events

Examples:

- `strike_started`
- `strike_resolved`
- `building_destroyed`
- `cooldown_started`
- `round_reset`

These are authoritative facts emitted by the system.

Clients should animate from domain events, not infer animation from snapshots.

## Why WebSocket Is Preferred for V2

SSE works for the MVP, but for very large scale and varied networks, WebSocket is the better default because:

- it handles bidirectional messaging on one connection
- it avoids some proxy buffering edge cases
- it is a more standard fit for real-time multiplayer gateways
- it gives more flexibility for heartbeat, presence, backpressure, and region streaming

SSE can still be used if operational simplicity matters more than flexibility, but for a genuinely large public game V2 should standardize on WebSocket.

## City and Map Scaling Strategy

Larger maps create two problems:

- more buildings in state
- more visuals per client

These should be solved separately.

### Authoritative State Scaling

The authoritative backend does not need to simulate every visual detail. It only needs compact city state:

- building id
- region id
- zone
- alive or destroyed
- timestamps

This is relatively lightweight even for large maps if stored compactly.

### Client Rendering Scaling

Clients should not render the entire world at full detail all the time.

V2 should support:

- region-based level of detail
- frustum-aware object reduction
- lower-detail far districts
- optional spectator simplification

The server does not need to stream every decorative mesh. It should stream authoritative gameplay entities plus enough metadata for the client to generate or select local visuals.

## Region Partitioning

For a much larger city, the map should be partitioned into regions or districts.

Each building belongs to:

- `mapId`
- `regionId`
- `buildingId`

Region partitioning provides three advantages:

1. Smaller snapshots
2. Lower client rendering cost
3. Future support for area-based subscriptions

### Recommended Region Model

- The map is globally shared
- The round remains one logical round
- Clients subscribe to global round events plus local region detail

Possible event distribution:

- global events
  - round lifecycle
  - total destruction counters
  - leaderboard
- regional events
  - strike_started in region X
  - strike_resolved in region X
  - building state deltas in region X

For the first scalable V2, region partitioning should be optional. Do not make it a mandatory architectural dependency on day one.

The more elegant default is:

- one global round
- one global event stream
- one authoritative destruction model
- larger static map metadata loaded separately

Then add regional subscription only if the full-city event stream or snapshot size becomes an actual bottleneck.

## Canonical Data Model

### Round

Core fields:

- `roundId`
- `mapId`
- `phase`: `active`, `cooldown`, `resetting`
- `startedAt`
- `endedAt`
- `cooldownEndsAt`
- `totalBuildings`
- `destroyedCount`

### Building

Core fields:

- `buildingId`
- `regionId`
- `zone`
- `x`
- `z`
- `width`
- `depth`
- `height`
- `destroyedAt`
- `destroyedBy`

### Strike

Core fields:

- `strikeId`
- `roundId`
- `buildingId`
- `regionId`
- `playerId`
- `startedAt`
- `impactAt`
- `outcome`
- `seed`

The `seed` is important. It lets clients generate the same visual missile profile deterministically without the server sending every visual parameter.

### Player

Core fields:

- `playerId`
- `displayName`
- `roundStrikeCount`
- optional long-term profile ids if authentication exists later

## Deterministic Visual Synchronization

To keep bandwidth low, the server should not stream missile coordinates frame-by-frame.

Instead, for each strike it should emit:

- `strikeId`
- `buildingId`
- `startedAt`
- `impactAt`
- `outcome`
- `seed`
- optional `missileProfile`

Each client then computes locally:

- trajectory type
- cluster formation
- interceptor timing
- audio variation
- cosmetic particle behavior

This preserves synchronized spectacle with very little network cost.

## Command Handling Flow

Recommended strike lifecycle:

1. Client sends `strike_request(buildingId)`
2. Command layer validates:
   - round active
   - building exists
   - building not destroyed
   - building not already targeted
3. Command layer atomically reserves the target in shared state
4. Command layer emits `strike_started`
5. All gateways push `strike_started`
6. Clients launch local animation
7. Worker resolves strike at `impactAt`
8. Worker emits `strike_resolved`
9. Shared state is updated atomically
10. Clients apply the result

This avoids relying on snapshots for animation replay.

## Atomicity and Concurrency

For large scale, concurrency bugs become more important than rendering cost.

The system must guarantee:

- a building cannot be destroyed twice
- a building cannot accept two active strikes at once unless rules allow it
- cooldown transition happens once
- round reset happens once

This should be enforced with atomic operations in Redis or database transactions in the command layer.

Examples:

- `SETNX` style reservation for active target lock
- Lua scripts in Redis for compound validation + mutation
- transactional updates for final resolution

## Snapshot Strategy

V2 only needs two snapshot levels initially:

1. Full bootstrap snapshot
2. Recovery snapshot

### Full Bootstrap Snapshot

Used when a client connects fresh.

Contains:

- round metadata
- current destruction state
- initial leaderboard
- optionally region metadata

### Recovery Snapshot

Used after reconnect or suspected desync.

Contains:

- current authoritative state only
- no replay semantics

## Event Ordering and Idempotency

All domain events should have:

- `eventId`
- `roundId`
- monotonic `sequence`
- timestamp

Clients should treat events as idempotent.

This means:

- duplicate `strike_started` is ignored if `strikeId` already seen
- duplicate `strike_resolved` is ignored if already applied
- late events from an old round are ignored by `roundId`

This is critical at large scale because duplicate delivery is common in distributed systems.

## App Node Design

Each app node should:

- accept WebSocket connections
- authenticate or identify users
- subscribe to the active round event stream in Redis
- maintain lightweight session state only
- push snapshots and deltas to clients

Each app node should not:

- own authoritative building state
- own the only copy of active strikes
- make authoritative gameplay decisions from local memory

## Worker Design

Workers handle delayed and scheduled tasks.

Responsibilities:

- resolve strike at impact time
- trigger cooldown when the city is fully destroyed
- generate the next city map
- publish `round_reset`

This is cleaner than many gateway nodes each owning their own timers.

At scale, strike resolution should be worker-driven rather than `setTimeout` in arbitrary app processes.

The cleanest implementation is:

- app node writes strike to Redis with `impactAt`
- worker claims due strikes and resolves them
- worker publishes `strike_resolved`

That is simpler and more reliable than spreading delayed timers across app instances.

## Persistence Strategy

### Hot Path

Store in Redis:

- active round metadata
- current building status
- active target locks
- strike schedule records
- leaderboard counters
- event fan-out

### Optional Durable Path

Store in Postgres only if needed:

- completed round history
- player accounts
- analytics
- abuse and moderation data

The optimized design is Redis-first, not Redis-plus-Postgres by default.

## Presence and Identity

For very large traffic, player identity should be lightweight by default.

Recommended progression:

1. Anonymous session ids
2. Optional display names
3. Optional authenticated accounts later

Presence does not need to be globally exact in real time. Approximate online counts are usually sufficient.

## Abuse Protection

At larger scale, abuse is guaranteed.

V2 should include:

- per-IP connection rate limiting
- per-session strike rate limiting
- invalid payload rejection
- maximum alias length and character filtering
- bot or spam heuristics if public

These controls belong at both the edge and command layers.

## Observability

This architecture should be built with operations in mind.

Required metrics:

- active connections by gateway
- message fan-out rate
- strike request rate
- strike reject rate by reason
- average strike start-to-delivery latency
- average strike resolve latency
- snapshot size
- reconnect rate
- event bus lag

Required logs:

- player connect and disconnect
- strike accepted and rejected
- round reset
- city destroyed
- gateway subscribe failures
- state-store and event-bus errors

Required tracing:

- command request to published event
- worker scheduling to resolution
- gateway event receipt to client delivery

## Failure Handling

### Gateway Failure

Expected behavior:

- clients reconnect to another gateway
- client requests new snapshot
- live stream resumes

### Worker Failure

Expected behavior:

- strike resolution jobs survive process failure
- unresolved strikes can be recovered from shared queue or scheduled store

### Redis or Event Bus Failure

This is a critical dependency. V2 should define degraded behavior:

- reject new strikes if authoritative state is unavailable
- keep clients connected if possible
- surface status clearly

### Client Desync

Expected recovery:

- client requests snapshot
- local transient animations are discarded if necessary
- authoritative state wins

## Multi-Region Considerations

If the game later serves global traffic, there are two options:

### Option A: Single Active Region

- one authoritative region for the active round
- global users connect there

Pros:

- simpler consistency

Cons:

- higher latency for distant users

### Option B: Global Edge, Single Authority

- gateways deployed in multiple regions
- one shared authoritative backend region
- edge gateways forward commands and stream events

This is often the best first global architecture.

Full multi-authority active-active design is possible, but it is much more complex and likely unnecessary for this game.

## Suggested V2 Component Stack

Recommended stack:

- Nginx, HAProxy, or cloud load balancer
- Node.js app nodes
- WebSocket transport
- Redis for hot state, locks, scheduling metadata, and pub/sub
- worker processes from the same codebase

Optional later additions:

- Postgres for persistence and analytics
- region-aware subscriptions
- multi-region gateway deployment

## Evolution Path

### Phase 1

Replace the single-process model with:

- shared Redis state
- stateless app nodes
- worker role
- `snapshot`, `strike_started`, `strike_resolved`

### Phase 2

Add:

- stronger observability
- optional Postgres if real persistence becomes necessary
- optional regional filtering if map scale requires it

### Phase 3

Add:

- durable event stream if Redis pub/sub is no longer enough
- replay-friendly history
- spectator optimization
- multiple edge/app regions

## What Should Stay Client-Side

To keep the architecture efficient, the following should remain local to the browser:

- missile interpolation
- cluster missile formation
- interceptor visuals
- particles
- explosion sound synthesis
- visual-only traffic
- environmental effects

The server should only control:

- what was targeted
- when
- by whom
- with what outcome

## Final Recommendation

The most elegant and optimized V2 for `Skyline MM` is:

- WebSocket app nodes, not separate gateway and command services
- Redis as the single hot-path authority
- worker-based strike resolution and round lifecycle
- `snapshot`, `strike_started`, and `strike_resolved` as the core protocol
- deterministic client-side animation from compact event payloads
- larger map metadata loaded separately from live destruction state
- region partitioning only when measurement proves it is needed

In short:

- keep the app tier stateless
- keep the hot path in Redis
- keep the live protocol minimal
- keep the client visually rich but simulation-light
- add durable storage only when there is a concrete product need

This is a smaller, cleaner, and more operationally elegant design than the broader stack in the first draft, while still being capable of scaling far beyond the current MVP.
