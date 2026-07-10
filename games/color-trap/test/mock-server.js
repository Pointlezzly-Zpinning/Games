const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const {
  applyMoveToState,
  nextRoundState,
  normalizeRoomState,
  resetMatchState,
} = require("../src/game.js");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 5174);
const rooms = new Map();
let roomCounter = 1;

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function publicRoom(record) {
  return { id: record.id, state: record.state, rev: record.rev };
}

function roomPayload(record, seat, token, extra = {}) {
  return {
    roomId: record.id,
    room: publicRoom(record),
    seat,
    token,
    ...extra,
  };
}

function nextRoomId() {
  const value = String(roomCounter++).padStart(5, "0");
  return `T${value}`;
}

function update(record, state) {
  record.state = normalizeRoomState(state);
  record.rev += 1;
  return record;
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/supabase-config") {
    json(response, 200, {
      configured: true,
      config: { url: `http://127.0.0.1:${port}`, anonKey: "mock-anon-key" },
    });
    return true;
  }

  if (url.pathname !== "/api/room") return false;
  if (request.method === "GET") {
    const record = rooms.get(String(url.searchParams.get("id") || "").toUpperCase());
    if (!record) json(response, 404, { error: "Room not found." });
    else json(response, 200, { room: publicRoom(record) });
    return true;
  }

  if (request.method !== "POST") {
    json(response, 405, { error: "Method not allowed." });
    return true;
  }

  const body = await readBody(request);
  if (body.action === "create") {
    const id = nextRoomId();
    const record = {
      id,
      rev: 0,
      state: resetMatchState("online", { p1: { name: body.name || "Host" }, p2: null }),
      tokens: { p1: `host-${id}`, p2: `guest-${id}` },
    };
    rooms.set(id, record);
    json(response, 200, roomPayload(record, "p1", record.tokens.p1));
    return true;
  }

  const roomId = String(body.roomId || "").toUpperCase();
  const record = rooms.get(roomId);
  if (!record) {
    json(response, 404, { error: "Room not found." });
    return true;
  }

  let seat = null;
  if (body.token === record.tokens.p1) seat = "p1";
  if (body.token === record.tokens.p2) seat = "p2";

  if (body.action === "join") {
    if (!seat) seat = "p2";
    record.state.players[seat] = { name: body.name || (seat === "p1" ? "Host" : "Guest") };
    if (record.state.players.p1 && record.state.players.p2 && record.state.phase === "lobby") {
      record.state.phase = "playing";
    }
    update(record, record.state);
    json(response, 200, roomPayload(record, seat, record.tokens[seat], { reconnected: Boolean(body.token) }));
    return true;
  }

  if (!seat) {
    json(response, 403, { error: "No seat in room." });
    return true;
  }

  if (body.action === "move") update(record, applyMoveToState(record.state, Number(body.index)));
  else if (body.action === "next-round") update(record, nextRoundState(record.state));
  else if (body.action === "rematch") {
    record.state.rematchVotes[seat] = true;
    if (record.state.rematchVotes.p1 && record.state.rematchVotes.p2) {
      const next = resetMatchState("online", record.state.players);
      next.phase = "playing";
      update(record, next);
    } else update(record, record.state);
  } else {
    json(response, 400, { error: "Unknown action." });
    return true;
  }

  json(response, 200, roomPayload(record, seat, record.tokens[seat]));
  return true;
}

const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (await handleApi(request, response, url)) return;
    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    const filePath = path.resolve(root, relative);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Color Trap mock server listening on http://127.0.0.1:${port}`);
});
