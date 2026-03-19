// Version: 1.0.6
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const COOLDOWN_MS = 10 * 60 * 1000;
const ADMIN_TOKEN = process.env.MM_ADMIN_TOKEN || "";
const STRIKE_TRAVEL_MS = 1800;
const AIRPLANE_TRAVEL_MS = 4800;
const STATE_PATH = path.join(__dirname, "state.json");
const PUBLIC_DIR = __dirname;

function parseCliArgs(argv) {
  const options = {
    layoutPath: process.env.MM_LAYOUT_PATH ? path.resolve(process.cwd(), process.env.MM_LAYOUT_PATH) : null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--layout") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --layout");
      }
      options.layoutPath = path.resolve(process.cwd(), next);
      index += 1;
    }
  }

  return options;
}

const CLI_OPTIONS = parseCliArgs(process.argv.slice(2));
const CITY_CONFIG = CLI_OPTIONS.layoutPath
  ? {
      source: "layout",
      layoutPath: CLI_OPTIONS.layoutPath
    }
  : {
      source: "procedural",
      layoutPath: null
    };

const clients = new Set();
const pendingStrikeTimers = new Map();
const activeStrikes = new Map();

function logEvent(type, details = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${type}`, details);
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function rand() {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  const stringValue = String(value || "");
  for (let index = 0; index < stringValue.length; index += 1) {
    hash ^= stringValue.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function chance(rand, value) {
  return rand() < value;
}

function loadLayoutDefinition(layoutPath) {
  const raw = fs.readFileSync(layoutPath, "utf8");
  const parsed = JSON.parse(raw);
  if (
    !parsed ||
    !parsed.grid ||
    typeof parsed.grid.cols !== "number" ||
    typeof parsed.grid.rows !== "number" ||
    !parsed.world ||
    typeof parsed.world.width !== "number" ||
    typeof parsed.world.depth !== "number" ||
    !Array.isArray(parsed.cells)
  ) {
    throw new Error(`Invalid layout file: ${layoutPath}`);
  }
  return parsed;
}

function addBuildingRecord(buildings, building) {
  buildings.push({
    ...building,
    destroyedAt: null,
    destroyedBy: null
  });
}

function addHighriseLot(buildings, rand, cell, blockId, lotId) {
  const baseW = cell.width * (0.66 + rand() * 0.18);
  const baseD = cell.depth * (0.66 + rand() * 0.18);
  const podiumH = 18 + rand() * 22;
  const offsetX = (rand() - 0.5) * cell.width * 0.12;
  const offsetZ = (rand() - 0.5) * cell.depth * 0.12;

  addBuildingRecord(buildings, {
    id: `${blockId}-${lotId}-podium`,
    x: cell.x + offsetX,
    z: cell.z + offsetZ,
    width: baseW,
    depth: baseD,
    height: podiumH,
    zone: "downtown"
  });

  const towerCount = chance(rand, 0.45) ? 2 : 1;
  for (let index = 0; index < towerCount; index += 1) {
    const towerW = baseW * (towerCount === 2 ? 0.32 + rand() * 0.11 : 0.4 + rand() * 0.18);
    const towerD = baseD * (towerCount === 2 ? 0.32 + rand() * 0.11 : 0.4 + rand() * 0.18);
    const shiftX = towerCount === 2 ? (index === 0 ? -towerW * 0.72 : towerW * 0.72) : (rand() - 0.5) * baseW * 0.1;
    const shiftZ = (rand() - 0.5) * baseD * 0.12;
    addBuildingRecord(buildings, {
      id: `${blockId}-${lotId}-tower-${index}`,
      x: cell.x + offsetX + shiftX,
      z: cell.z + offsetZ + shiftZ,
      width: towerW,
      depth: towerD,
      height: 140 + rand() * 180,
      zone: "downtown"
    });
  }
}

function addMidriseLot(buildings, rand, cell, blockId, lotId) {
  const count = chance(rand, 0.76) ? 1 : 2;
  for (let index = 0; index < count; index += 1) {
    addBuildingRecord(buildings, {
      id: `${blockId}-${lotId}-mid-${index}`,
      x: cell.x + (rand() - 0.5) * cell.width * 0.24,
      z: cell.z + (rand() - 0.5) * cell.depth * 0.24,
      width: cell.width * (0.42 + rand() * 0.26),
      depth: cell.depth * (0.42 + rand() * 0.26),
      height: 48 + rand() * 74,
      zone: "midrise"
    });
  }
}

function addHouseLot(buildings, rand, cell, blockId, lotId) {
  const count = chance(rand, 0.72) ? 1 : 2;
  for (let index = 0; index < count; index += 1) {
    addBuildingRecord(buildings, {
      id: `${blockId}-${lotId}-house-${index}`,
      x: cell.x + (rand() - 0.5) * cell.width * 0.26,
      z: cell.z + (rand() - 0.5) * cell.depth * 0.26,
      width: Math.max(10, cell.width * (0.42 + rand() * 0.18)),
      depth: Math.max(10, cell.depth * (0.42 + rand() * 0.18)),
      height: 10 + rand() * 16,
      zone: "residential"
    });
  }
}

function buildCityFromLayout(seed, layoutDefinition) {
  const rand = mulberry32(seed ^ hashString(layoutDefinition.name || path.basename(CITY_CONFIG.layoutPath || "")));
  const buildings = [];
  const cols = layoutDefinition.grid.cols;
  const rows = layoutDefinition.grid.rows;
  const worldWidth = layoutDefinition.world.width;
  const worldDepth = layoutDefinition.world.depth;
  const cellWorldWidth = worldWidth / cols;
  const cellWorldDepth = worldDepth / rows;
  const halfWorldWidth = worldWidth * 0.5;
  const halfWorldDepth = worldDepth * 0.5;

  for (const cell of layoutDefinition.cells) {
    if (!cell || typeof cell.x !== "number" || typeof cell.y !== "number") {
      continue;
    }
    if (cell.type === "roads" || cell.type === "parks") {
      continue;
    }

    const centerX = -halfWorldWidth + cellWorldWidth * (cell.x + 0.5);
    const centerZ = -halfWorldDepth + cellWorldDepth * (cell.y + 0.5);
    const lot = {
      x: centerX,
      z: centerZ,
      width: cellWorldWidth * 0.92,
      depth: cellWorldDepth * 0.92
    };
    const blockId = `c-${cell.x}-${cell.y}`;
    const lotId = cell.type;

    if (cell.type === "highrise") {
      addHighriseLot(buildings, rand, lot, blockId, lotId);
    } else if (cell.type === "midrise") {
      addMidriseLot(buildings, rand, lot, blockId, lotId);
    } else if (cell.type === "houses") {
      addHouseLot(buildings, rand, lot, blockId, lotId);
    }
  }

  return buildings.sort((a, b) => a.x - b.x || a.z - b.z || a.height - b.height);
}

function buildCity(seed) {
  const rand = mulberry32(seed);
  const buildings = [];
  const CITY_SIZE = 900;
  const HALF = CITY_SIZE * 0.5;
  const ROAD_W = 10;
  const BLOCK = 36;
  const DOWNTOWN_RADIUS = 140;
  function zoneAt(x, z) {
    const d = Math.sqrt(x * x + z * z);
    if (d < DOWNTOWN_RADIUS) {
      return "downtown";
    }
    if (d < 260) {
      return chance(0.6) ? "midrise" : "park";
    }
    if (d < 380) {
      return chance(0.66) ? "residential" : "park";
    }
    return chance(0.72) ? "suburban" : "park";
  }

  function addTowerLot(x, z, lotW, lotD, blockId, lotId) {
    const podiumH = 14 + rand() * 16;
    const podiumW = lotW * (0.7 + rand() * 0.18);
    const podiumD = lotD * (0.7 + rand() * 0.18);
    const baseJitterX = (rand() - 0.5) * lotW * 0.1;
    const baseJitterZ = (rand() - 0.5) * lotD * 0.1;
    addBuildingRecord(buildings, {
      id: `${blockId}-${lotId}-podium`,
      x: x + baseJitterX,
      z: z + baseJitterZ,
      width: podiumW,
      depth: podiumD,
      height: podiumH,
      zone: "downtown"
    });

    const towerCount = chance(0.36) ? 2 : 1;
    for (let index = 0; index < towerCount; index += 1) {
      const towerW = podiumW * (towerCount === 2 ? 0.34 + rand() * 0.12 : 0.38 + rand() * 0.24);
      const towerD = podiumD * (towerCount === 2 ? 0.34 + rand() * 0.12 : 0.38 + rand() * 0.24);
      const offsetX = towerCount === 2 ? (index === 0 ? -towerW * 0.7 : towerW * 0.7) : (rand() - 0.5) * podiumW * 0.08;
      const offsetZ = (rand() - 0.5) * podiumD * 0.12;
      addBuildingRecord(buildings, {
        id: `${blockId}-${lotId}-tower-${index}`,
        x: x + baseJitterX + offsetX,
        z: z + baseJitterZ + offsetZ,
        width: towerW,
        depth: towerD,
        height: 120 + rand() * 190,
        zone: "downtown"
      });
    }
  }

  function addMidriseLot(x, z, lotW, lotD, blockId, lotId) {
    const count = chance(rand, 0.8) ? 1 : 2;
    for (let index = 0; index < count; index += 1) {
      const footprintW = lotW * (0.34 + rand() * 0.34);
      const footprintD = lotD * (0.34 + rand() * 0.34);
      addBuildingRecord(buildings, {
        id: `${blockId}-${lotId}-mid-${index}`,
        x: x + (rand() - 0.5) * lotW * 0.3,
        z: z + (rand() - 0.5) * lotD * 0.3,
        width: footprintW,
        depth: footprintD,
        height: 42 + rand() * 72,
        zone: "midrise"
      });
    }
  }

  function addResidentialLot(x, z, lotW, lotD, blockId, lotId) {
    const count = chance(rand, 0.84) ? 1 : 2;
    for (let index = 0; index < count; index += 1) {
      const width = 10 + rand() * 9;
      const depth = 10 + rand() * 9;
      addBuildingRecord(buildings, {
        id: `${blockId}-${lotId}-res-${index}`,
        x: x + (rand() - 0.5) * Math.max(lotW * 0.34, 4),
        z: z + (rand() - 0.5) * Math.max(lotD * 0.34, 4),
        width,
        depth,
        height: 10 + rand() * 16,
        zone: "residential"
      });
    }
  }

  function addSuburbanLot(x, z, lotW, lotD, blockId, lotId) {
    addBuildingRecord(buildings, {
      id: `${blockId}-${lotId}-suburban`,
      x: x + (rand() - 0.5) * lotW * 0.22,
      z: z + (rand() - 0.5) * lotD * 0.22,
      width: 11 + rand() * 10,
      depth: 11 + rand() * 10,
      height: 8 + rand() * 10,
      zone: "suburban"
    });
  }

  function isMajorRoadLine(value) {
    const mod = Math.abs(value % 90);
    return mod < 1 || Math.abs(mod - 90) < 1;
  }

  for (let gx = -HALF + 25; gx < HALF - 25; gx += BLOCK + ROAD_W) {
    for (let gz = -HALF + 25; gz < HALF - 25; gz += BLOCK + ROAD_W) {
      if (isMajorRoadLine(gx) || isMajorRoadLine(gz)) {
        continue;
      }

      const zone = zoneAt(gx, gz);
      if (chance(rand, 0.1)) {
        continue;
      }
      if (zone === "park" || chance(rand, 0.08)) {
        continue;
      }

      const blockId = `b-${gx}-${gz}`.replace(/\./g, "_");
      const lotsX = zone === "downtown" ? (chance(rand, 0.82) ? 1 : 2) : (chance(rand, 0.72) ? 1 : 2);
      const lotsZ = zone === "downtown" ? (chance(rand, 0.82) ? 1 : 2) : (chance(rand, 0.72) ? 1 : 2);
      const blockFill = zone === "downtown" ? 0.9 : 0.82 + rand() * 0.1;
      const usableW = BLOCK * blockFill;
      const usableD = BLOCK * blockFill;
      const blockShiftX = (rand() - 0.5) * (BLOCK * (zone === "downtown" ? 0.08 : 0.16));
      const blockShiftZ = (rand() - 0.5) * (BLOCK * (zone === "downtown" ? 0.08 : 0.16));
      const lotW = usableW / lotsX;
      const lotD = usableD / lotsZ;

      for (let ix = 0; ix < lotsX; ix += 1) {
        for (let iz = 0; iz < lotsZ; iz += 1) {
          const laneBendX = lotsX > 1 ? (iz - (lotsZ - 1) * 0.5) * rand() * 2.2 : 0;
          const laneBendZ = lotsZ > 1 ? (ix - (lotsX - 1) * 0.5) * rand() * 2.2 : 0;
          const x = gx + blockShiftX - usableW * 0.5 + lotW * (ix + 0.5) + laneBendX;
          const z = gz + blockShiftZ - usableD * 0.5 + lotD * (iz + 0.5) + laneBendZ;
          const lotId = `lot-${ix}-${iz}`;

          if (zone === "downtown") {
            addTowerLot(x, z, lotW * 0.92, lotD * 0.92, blockId, lotId);
          } else if (zone === "midrise") {
            addMidriseLot(x, z, lotW * 0.9, lotD * 0.9, blockId, lotId);
          } else if (zone === "residential") {
            addResidentialLot(x, z, lotW * 0.9, lotD * 0.9, blockId, lotId);
          } else {
            addSuburbanLot(x, z, lotW * 0.9, lotD * 0.9, blockId, lotId);
          }
        }
      }
    }
  }

  return buildings.sort((a, b) => a.x - b.x || a.z - b.z || a.height - b.height);
}

const LAYOUT_DEFINITION = CITY_CONFIG.source === "layout" ? loadLayoutDefinition(CITY_CONFIG.layoutPath) : null;

function createRound(roundId) {
  const seed = Date.now() ^ (roundId * 2654435761);
  const buildings = CITY_CONFIG.source === "layout"
    ? buildCityFromLayout(seed, LAYOUT_DEFINITION)
    : buildCity(seed);
  return {
    roundId,
    seed,
    citySource: CITY_CONFIG.source,
    cityLayoutName: LAYOUT_DEFINITION ? LAYOUT_DEFINITION.name || path.basename(CITY_CONFIG.layoutPath) : null,
    phase: "active",
    startedAt: Date.now(),
    endedAt: null,
    cooldownEndsAt: null,
    totalBuildings: buildings.length,
    destroyedCount: 0,
    strikeSeq: 0,
    lastEventAt: Date.now(),
    players: {},
    buildings
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      !Array.isArray(parsed.buildings) ||
      (parsed.buildings[0] && (typeof parsed.buildings[0].z !== "number" || typeof parsed.buildings[0].depth !== "number"))
    ) {
      throw new Error("Invalid state file");
    }
    if ((parsed.citySource || "procedural") !== CITY_CONFIG.source) {
      throw new Error("State source mismatch");
    }
    if (CITY_CONFIG.source === "layout") {
      const expectedLayoutName = LAYOUT_DEFINITION ? (LAYOUT_DEFINITION.name || path.basename(CITY_CONFIG.layoutPath)) : null;
      if ((parsed.cityLayoutName || null) !== expectedLayoutName) {
        throw new Error("State layout mismatch");
      }
    }
    delete parsed.lastStrike;
    delete parsed.pendingStrikes;
    return parsed;
  } catch {
    return createRound(1);
  }
}

let state = loadState();

function saveState() {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function currentPayload() {
  const leaderboard = Object.entries(state.players)
    .map(([playerId, player]) => ({
      playerId,
      name: player.name,
      strikes: player.strikes
    }))
    .sort((a, b) => b.strikes - a.strikes || a.name.localeCompare(b.name))
    .slice(0, 10);

  return {
    roundId: state.roundId,
    seed: state.seed,
    citySource: state.citySource || "procedural",
    cityLayoutName: state.cityLayoutName || null,
    phase: state.phase,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    cooldownEndsAt: state.cooldownEndsAt,
    totalBuildings: state.totalBuildings,
    destroyedCount: state.destroyedCount,
    remainingBuildings: state.totalBuildings - state.destroyedCount,
    leaderboard,
    buildings: state.buildings
  };
}

function broadcast(type, payload = currentPayload()) {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}

function registerPlayer(playerId, name) {
  if (!playerId) {
    return;
  }
  const sanitized = String(name || "Anonymous").trim().slice(0, 24) || "Anonymous";
  if (!state.players[playerId]) {
    state.players[playerId] = {
      name: sanitized,
      strikes: 0
    };
    state.lastEventAt = Date.now();
    logEvent("player_joined", { playerId, name: sanitized });
    saveState();
    broadcast("leaderboard");
    return;
  }
  if (sanitized && state.players[playerId].name !== sanitized) {
    logEvent("player_renamed", {
      playerId,
      previousName: state.players[playerId].name,
      name: sanitized
    });
    state.players[playerId].name = sanitized;
    state.lastEventAt = Date.now();
    saveState();
    broadcast("leaderboard");
  }
}

function chooseStrikeVehicle(building) {
  if (!building) {
    return "missile";
  }
  if (building.zone === "downtown" && building.height >= 120 && Math.random() < 0.3) {
    return "airplane";
  }
  return "missile";
}

function resetRound() {
  const previousRoundId = state.roundId;
  pendingStrikeTimers.forEach((timer) => clearTimeout(timer));
  pendingStrikeTimers.clear();
  activeStrikes.clear();
  state = createRound(state.roundId + 1);
  logEvent("round_reset", {
    previousRoundId,
    roundId: state.roundId,
    totalBuildings: state.totalBuildings
  });
  saveState();
  broadcast("round_reset");
}

function isAuthorizedAdmin(req, url) {
  if (!ADMIN_TOKEN) {
    return true;
  }
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const queryToken = url.searchParams.get("token") || "";
  return bearerToken === ADMIN_TOKEN || queryToken === ADMIN_TOKEN;
}

function maybeAdvanceCooldown() {
  if (state.phase !== "cooldown") {
    return;
  }
  if (Date.now() >= state.cooldownEndsAt) {
    resetRound();
  }
}

function resolveStrike(strikeId) {
  const strike = activeStrikes.get(strikeId);
  if (!strike) {
    return;
  }
  activeStrikes.delete(strikeId);
  pendingStrikeTimers.delete(strikeId);

  const building = state.buildings.find((item) => item.id === strike.buildingId);
  if (!building) {
    saveState();
    broadcast("snapshot");
    return;
  }

  if (strike.outcome === "destroyed" && !building.destroyedAt) {
    building.destroyedAt = Date.now();
    building.destroyedBy = strike.playerId || "anonymous";
    state.destroyedCount += 1;

    if (strike.playerId) {
      state.players[strike.playerId] = state.players[strike.playerId] || { name: "Anonymous", strikes: 0 };
      state.players[strike.playerId].strikes += 1;
      if (strike.playerName) {
        state.players[strike.playerId].name = String(strike.playerName).trim().slice(0, 24) || state.players[strike.playerId].name;
      }
    }
  }

  if (strike.outcome === "destroyed" && state.destroyedCount >= state.totalBuildings) {
    state.phase = "cooldown";
    state.endedAt = Date.now();
    state.cooldownEndsAt = state.endedAt + COOLDOWN_MS;
    logEvent("city_destroyed", {
      roundId: state.roundId,
      endedAt: state.endedAt,
      cooldownEndsAt: state.cooldownEndsAt
    });
  }

  broadcast("strike_resolved", {
    roundId: state.roundId,
    strike: {
      strikeId: strike.strikeId,
      seq: strike.seq,
      buildingId: strike.buildingId,
      vehicle: strike.vehicle || "missile",
      playerId: strike.playerId,
      playerName: strike.playerName,
      startedAt: strike.startedAt,
      impactAt: strike.impactAt,
      resolvedAt: Date.now(),
      outcome: strike.outcome
    }
  });
  saveState();
  broadcast("snapshot");
}

function markDestroyed(buildingId, playerId, playerName) {
  maybeAdvanceCooldown();
  registerPlayer(playerId, playerName);

  if (state.phase !== "active") {
    logEvent("strike_rejected", {
      reason: "round_in_cooldown",
      playerId: playerId || "anonymous",
      playerName: playerName || "Anonymous",
      buildingId
    });
    return { ok: false, code: 409, error: "Round is in cooldown." };
  }

  const building = state.buildings.find((item) => item.id === buildingId);
  if (!building) {
    logEvent("strike_rejected", {
      reason: "building_not_found",
      playerId: playerId || "anonymous",
      playerName: playerName || "Anonymous",
      buildingId
    });
    return { ok: false, code: 404, error: "Building not found." };
  }
  if (building.destroyedAt) {
    logEvent("strike_rejected", {
      reason: "building_already_destroyed",
      playerId: playerId || "anonymous",
      playerName: playerName || "Anonymous",
      buildingId,
      destroyedAt: building.destroyedAt,
      destroyedBy: building.destroyedBy
    });
    return { ok: false, code: 409, error: "Building already destroyed." };
  }
  if (Array.from(activeStrikes.values()).some((item) => item.buildingId === buildingId)) {
    logEvent("strike_rejected", {
      reason: "building_already_targeted",
      playerId: playerId || "anonymous",
      playerName: playerName || "Anonymous",
      buildingId
    });
    return { ok: false, code: 409, error: "Building already targeted." };
  }

  const startedAt = Date.now();
  const intercepted = Math.random() < 0.2;
  state.strikeSeq = (state.strikeSeq || 0) + 1;
  const vehicle = chooseStrikeVehicle(building);
  const travelMs = vehicle === "airplane" ? AIRPLANE_TRAVEL_MS : STRIKE_TRAVEL_MS;
  const strike = {
    strikeId: `${state.roundId}-${state.strikeSeq}-${buildingId}`,
    seq: state.strikeSeq,
    buildingId,
    vehicle,
    playerId: playerId || "anonymous",
    playerName: playerName || ((state.players[playerId] && state.players[playerId].name) || "Anonymous"),
    startedAt,
    impactAt: startedAt + travelMs,
    outcome: intercepted ? "intercepted" : "destroyed"
  };
  activeStrikes.set(strike.strikeId, strike);

  logEvent("strike_started", {
    playerId: playerId || "anonymous",
    playerName: strike.playerName,
    buildingId,
    vehicle: strike.vehicle,
    outcome: strike.outcome,
    roundId: state.roundId
  });
  broadcast("strike_started", {
    roundId: state.roundId,
    strike
  });

  state.lastEventAt = Date.now();
  saveState();
  pendingStrikeTimers.set(strike.strikeId, setTimeout(() => resolveStrike(strike.strikeId), travelMs));
  return { ok: true, code: 200, payload: currentPayload() };
}

function sendJson(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function serveFile(reqPath, res) {
  if (reqPath === "/shared/cyberpunk.jpg" || reqPath === "/shared/skyline.jpg") {
    const assetName = path.basename(reqPath);
    const resolvedPath = path.join(path.dirname(PUBLIC_DIR), assetName);
    fs.readFile(resolvedPath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(data);
    });
    return;
  }

  const pathname = reqPath === "/" ? "/index.html" : reqPath;
  const resolvedPath = path.join(PUBLIC_DIR, pathname);
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(resolvedPath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".jpg": "image/jpeg"
    };

    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream"
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  maybeAdvanceCooldown();
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, currentPayload());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    try {
      const body = await readBody(req);
      registerPlayer(body.playerId, body.playerName);
      sendJson(res, 200, currentPayload());
    } catch (error) {
      logEvent("register_error", { error: error.message });
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/strike") {
    try {
      const body = await readBody(req);
      const result = markDestroyed(body.buildingId, body.playerId, body.playerName);
      sendJson(res, result.code, result.ok ? result.payload : { error: result.error, ...currentPayload() });
    } catch (error) {
      logEvent("strike_error", { error: error.message });
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/regen") {
    if (!isAuthorizedAdmin(req, url)) {
      logEvent("admin_regen_rejected", { reason: "forbidden" });
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }
    logEvent("admin_regen_requested", { roundId: state.roundId });
    resetRound();
    sendJson(res, 200, currentPayload());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    res.write("retry: 2000\n\n");
    clients.add(res);
    logEvent("events_connected", { clients: clients.size });
    res.write(`event: snapshot\ndata: ${JSON.stringify(currentPayload())}\n\n`);
    req.on("close", () => {
      clients.delete(res);
      logEvent("events_disconnected", { clients: clients.size });
    });
    return;
  }

  serveFile(url.pathname, res);
});

setInterval(maybeAdvanceCooldown, 1000);

saveState();

server.listen(PORT, HOST, () => {
  logEvent("server_started", {
    url: `http://${HOST}:${PORT}`,
    roundId: state.roundId,
    totalBuildings: state.totalBuildings,
    citySource: state.citySource || "procedural",
    cityLayoutName: state.cityLayoutName || null
  });
});
