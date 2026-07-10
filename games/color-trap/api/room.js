const crypto = require("node:crypto");
const {
  PLAYER_ORDER,
  applyMoveToState,
  nextRoundState,
  normalizeRoomState,
  resetMatchState,
} = require("../src/game.js");

const ROOM_TABLE = "color_trap_rooms";
const SECRET_TABLE = "color_trap_room_secrets";
const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_ID_LENGTH = 6;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanRoomId(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ROOM_ID_LENGTH);
}

function cleanName(value) {
  return String(value || "Player").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 18) || "Player";
}

function createRoomId() {
  const bytes = crypto.randomBytes(ROOM_ID_LENGTH);
  return Array.from(bytes, (value) => ROOM_ID_ALPHABET[value % ROOM_ID_ALPHABET.length]).join("");
}

function createSeatToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function tokenMatches(token, expectedHash) {
  if (!token || !expectedHash) return false;
  const actual = Buffer.from(hashToken(token));
  const expected = Buffer.from(String(expectedHash));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function seatForToken(secret, token) {
  if (tokenMatches(token, secret?.p1_token_hash)) return "p1";
  if (tokenMatches(token, secret?.p2_token_hash)) return "p2";
  return null;
}

function getConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) throw new HttpError(503, "Online play is not configured yet.");
  return { url, serviceKey };
}

async function databaseRequest(resource, options = {}) {
  const { url, serviceKey } = getConfig();
  const response = await fetch(`${url}/rest/v1/${resource}`, {
    method: options.method || "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }
  if (!response.ok) {
    const error = new HttpError(response.status, "The room service could not complete that action.");
    error.databaseCode = payload?.code || "";
    throw error;
  }
  return payload;
}

async function getRoomRow(roomId) {
  const rows = await databaseRequest(
    `${ROOM_TABLE}?id=eq.${encodeURIComponent(roomId)}&select=id,state,rev,updated_at&limit=1`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getSecretRow(roomId) {
  const rows = await databaseRequest(
    `${SECRET_TABLE}?room_id=eq.${encodeURIComponent(roomId)}&select=room_id,p1_token_hash,p2_token_hash&limit=1`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

function roomExpired(row) {
  const updated = Date.parse(row?.updated_at || "");
  return Number.isFinite(updated) && Date.now() - updated > ROOM_TTL_MS;
}

async function deleteRoom(roomId) {
  await databaseRequest(`${ROOM_TABLE}?id=eq.${encodeURIComponent(roomId)}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
}

async function loadRoom(roomId, includeSecret = false) {
  const [room, secret] = await Promise.all([
    getRoomRow(roomId),
    includeSecret ? getSecretRow(roomId) : Promise.resolve(null),
  ]);
  if (!room) throw new HttpError(404, "That room does not exist or has expired.");
  if (roomExpired(room)) {
    await deleteRoom(roomId).catch(() => {});
    throw new HttpError(404, "That room has expired.");
  }
  if (includeSecret && !secret) throw new HttpError(409, "That room is missing its access record.");
  return { room, secret };
}

async function updateRoom(room, nextState) {
  const rows = await databaseRequest(
    `${ROOM_TABLE}?id=eq.${encodeURIComponent(room.id)}&rev=eq.${Number(room.rev || 0)}&select=id,state,rev,updated_at`,
    {
      method: "PATCH",
      body: {
        state: normalizeRoomState(nextState),
        rev: Number(room.rev || 0) + 1,
        updated_at: new Date().toISOString(),
      },
    }
  );
  if (!Array.isArray(rows) || !rows[0]) throw new HttpError(409, "The board changed. Try that move again.");
  return rows[0];
}

async function claimGuestToken(roomId, tokenHash) {
  const rows = await databaseRequest(
    `${SECRET_TABLE}?room_id=eq.${encodeURIComponent(roomId)}&p2_token_hash=is.null&select=room_id,p1_token_hash,p2_token_hash`,
    { method: "PATCH", body: { p2_token_hash: tokenHash } }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

function publicRoom(row) {
  return {
    id: row.id,
    state: normalizeRoomState(row.state),
    rev: Number(row.rev || 0),
    updatedAt: row.updated_at,
  };
}

async function createRoom(name) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const roomId = createRoomId();
    const token = createSeatToken();
    const state = resetMatchState("online", { p1: { name }, p2: null });
    try {
      const rooms = await databaseRequest(`${ROOM_TABLE}?select=id,state,rev,updated_at`, {
        method: "POST",
        body: { id: roomId, state, rev: 0 },
      });
      const room = rooms?.[0];
      if (!room) throw new HttpError(500, "The room could not be created.");
      try {
        await databaseRequest(SECRET_TABLE, {
          method: "POST",
          body: {
            room_id: roomId,
            p1_token_hash: hashToken(token),
            p2_token_hash: null,
          },
        });
      } catch (error) {
        await deleteRoom(roomId).catch(() => {});
        throw error;
      }
      return { roomId, room: publicRoom(room), seat: "p1", token };
    } catch (error) {
      if (error.databaseCode === "23505" || error.status === 409) continue;
      throw error;
    }
  }
  throw new HttpError(503, "A room code could not be created. Please try again.");
}

async function joinRoom(roomId, name, suppliedToken) {
  let { room, secret } = await loadRoom(roomId, true);
  let seat = seatForToken(secret, suppliedToken);
  let token = suppliedToken;
  let reconnected = Boolean(seat);

  if (!seat) {
    if (secret.p2_token_hash || normalizeRoomState(room.state).players.p2) {
      throw new HttpError(409, "That room already has two players.");
    }
    token = createSeatToken();
    const claimed = await claimGuestToken(roomId, hashToken(token));
    if (!claimed) throw new HttpError(409, "Another player just filled that room.");
    secret = claimed;
    seat = "p2";
    reconnected = false;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = normalizeRoomState(room.state);
    state.players[seat] = { name };
    if (state.players.p1 && state.players.p2 && state.phase === "lobby") {
      state.phase = "playing";
      state.current = state.starter || "p1";
    }
    try {
      room = await updateRoom(room, state);
      return { roomId, room: publicRoom(room), seat, token, reconnected };
    } catch (error) {
      if (error.status !== 409 || attempt === 2) throw error;
      const latest = await loadRoom(roomId, true);
      room = latest.room;
      secret = latest.secret;
      if (seatForToken(secret, token) !== seat) {
        throw new HttpError(409, "Another player just filled that room.");
      }
    }
  }
  throw new HttpError(409, "The room changed while you were joining. Please try again.");
}

async function authorizeRoom(roomId, token) {
  const { room, secret } = await loadRoom(roomId, true);
  const seat = seatForToken(secret, token);
  if (!seat) throw new HttpError(403, "This browser does not have a seat in that room.");
  return { room, seat };
}

async function moveInRoom(roomId, token, rawIndex) {
  const { room, seat } = await authorizeRoom(roomId, token);
  const state = normalizeRoomState(room.state);
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0 || index >= state.board.length) {
    throw new HttpError(400, "That board space is invalid.");
  }
  if (state.phase !== "playing") throw new HttpError(409, "That round is not active.");
  if (state.current !== seat) throw new HttpError(409, "It is not your turn.");
  if (state.board[index]) throw new HttpError(409, "That space is already occupied.");
  const next = applyMoveToState(state, index);
  const updated = await updateRoom(room, next);
  return { roomId, room: publicRoom(updated), seat };
}

async function advanceRoom(roomId, token) {
  const { room, seat } = await authorizeRoom(roomId, token);
  const state = normalizeRoomState(room.state);
  if (state.phase !== "roundover") throw new HttpError(409, "The next round is not ready yet.");
  const updated = await updateRoom(room, nextRoundState(state));
  return { roomId, room: publicRoom(updated), seat };
}

async function requestRematch(roomId, token) {
  const { room, seat } = await authorizeRoom(roomId, token);
  const state = normalizeRoomState(room.state);
  if (state.phase !== "matchover") throw new HttpError(409, "The current match is not over.");
  state.rematchVotes[seat] = true;
  let next = state;
  if (state.rematchVotes.p1 && state.rematchVotes.p2) {
    next = resetMatchState("online", state.players);
    next.phase = "playing";
  }
  const updated = await updateRoom(room, next);
  return { roomId, room: publicRoom(updated), seat };
}

async function renamePlayer(roomId, token, name) {
  const { room, seat } = await authorizeRoom(roomId, token);
  const state = normalizeRoomState(room.state);
  state.players[seat] = { name };
  const updated = await updateRoom(room, state);
  return { roomId, room: publicRoom(updated), seat };
}

function sendJson(response, status, payload) {
  response.status(status).json(payload);
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");

  try {
    if (request.method === "GET") {
      const roomId = cleanRoomId(request.query?.id);
      if (roomId.length !== ROOM_ID_LENGTH) throw new HttpError(400, "A valid room code is required.");
      const { room } = await loadRoom(roomId, false);
      sendJson(response, 200, { room: publicRoom(room) });
      return;
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      throw new HttpError(405, "Method not allowed.");
    }

    if (Number(request.headers?.["content-length"] || 0) > 4096) {
      throw new HttpError(413, "The room request is too large.");
    }

    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : (request.body || {});
    const action = String(body.action || "");
    const roomId = cleanRoomId(body.roomId);
    const token = String(body.token || "");
    let result;

    if (action === "create") {
      result = await createRoom(cleanName(body.name));
    } else {
      if (roomId.length !== ROOM_ID_LENGTH) throw new HttpError(400, "A valid room code is required.");
      switch (action) {
        case "join":
          result = await joinRoom(roomId, cleanName(body.name), token);
          break;
        case "move":
          result = await moveInRoom(roomId, token, body.index);
          break;
        case "next-round":
          result = await advanceRoom(roomId, token);
          break;
        case "rematch":
          result = await requestRematch(roomId, token);
          break;
        case "rename":
          result = await renamePlayer(roomId, token, cleanName(body.name));
          break;
        default:
          throw new HttpError(400, "Unknown room action.");
      }
    }

    sendJson(response, 200, result);
  } catch (error) {
    const status = Number(error.status || 500);
    if (status >= 500) console.error("Color Trap room error", error.message);
    sendJson(response, status, { error: status >= 500 ? "Online play is temporarily unavailable." : error.message });
  }
};

module.exports._internals = {
  cleanName,
  cleanRoomId,
  hashToken,
  seatForToken,
  tokenMatches,
};
