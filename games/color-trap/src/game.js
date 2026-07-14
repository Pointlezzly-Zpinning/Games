(function () {
  "use strict";

  const BOARD_SIZE = 6;
  const MATCH_TARGET = 3;
  const OBJECTIVE_AVOID = "avoid";
  const OBJECTIVE_MAKE = "make";
  const STORAGE_MATCH = "colorTrapLocalMatchV2";
  const STORAGE_SETTINGS = "colorTrapSettingsV2";
  const ROOM_ID_LENGTH = 6;
  const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const ROOM_JOIN_TIMEOUT_MS = 9000;
  const ROOM_SYNC_INTERVAL_MS = 2500;
  const ROOM_RECONNECT_DELAY_MS = 900;
  const PLAYER_ORDER = Object.freeze(["p1", "p2"]);
  const PLAYER_INFO = Object.freeze({
    p1: { color: "Red", token: "R" },
    p2: { color: "Blue", token: "B" },
  });

  const TRAPS = Object.freeze([
    {
      id: "line4",
      name: "Line of 4",
      shortName: "Line of 4",
      level: "Balanced",
      meta: "4 pieces | any direction",
      rule: "Horizontal, vertical, and both diagonal lines count.",
      cells: [[0, 0], [1, 0], [2, 0], [3, 0]],
    },
    {
      id: "triangle",
      name: "Wave",
      shortName: "Wave",
      level: "Sharp",
      meta: "4 pieces | diagonal chain",
      rule: "Follow A1-B2-C1-D2. Rotations and mirror images count.",
      cells: [[0, 0], [1, 1], [2, 0], [3, 1]],
    },
    {
      id: "square",
      name: "Small Square",
      shortName: "Square",
      level: "Balanced",
      meta: "4 pieces | connected",
      rule: "Any tight 2 by 2 square counts.",
      cells: [[0, 0], [1, 0], [0, 1], [1, 1]],
    },
    {
      id: "diamond",
      name: "Diamond",
      shortName: "Diamond",
      level: "Patient",
      meta: "4 pieces | exact spacing",
      rule: "The open center does not need to be empty. Only the four points matter.",
      cells: [[1, 0], [0, 1], [2, 1], [1, 2]],
    },
    {
      id: "corner",
      name: "Corner",
      shortName: "Corner",
      level: "Sharp",
      meta: "4 pieces | connected",
      rule: "Rotations and mirror images count.",
      cells: [[0, 0], [0, 1], [0, 2], [1, 2]],
    },
    {
      id: "zigzag",
      name: "Zigzag",
      shortName: "Zigzag",
      level: "Sharp",
      meta: "4 pieces | connected",
      rule: "Rotations and mirror images count.",
      cells: [[0, 0], [1, 0], [1, 1], [2, 1]],
    },
    {
      id: "tee",
      name: "T Shape",
      shortName: "T Shape",
      level: "Sharp",
      meta: "4 pieces | connected",
      rule: "Rotations and mirror images count.",
      cells: [[0, 0], [1, 0], [2, 0], [1, 1]],
    },
  ]);

  const orientationCache = new Map();
  const placementCache = new Map();

  function emptyBoard(size = BOARD_SIZE) {
    return Array.from({ length: size * size }, () => null);
  }

  function trapById(id) {
    return TRAPS.find((trap) => trap.id === id) || TRAPS[0];
  }

  function otherPlayer(player) {
    return player === "p1" ? "p2" : "p1";
  }

  function normalizeObjective(value) {
    return value === OBJECTIVE_MAKE ? OBJECTIVE_MAKE : OBJECTIVE_AVOID;
  }

  function indexFor(x, y, size = BOARD_SIZE) {
    return y * size + x;
  }

  function pointForIndex(index, size = BOARD_SIZE) {
    return { x: index % size, y: Math.floor(index / size) };
  }

  function coordForIndex(index, size = BOARD_SIZE) {
    const { x, y } = pointForIndex(index, size);
    return `${String.fromCharCode(65 + x)}${y + 1}`;
  }

  function indexForCoord(coord, size = BOARD_SIZE) {
    const cleaned = String(coord || "").trim().toUpperCase();
    if (!/^[A-Z][0-9]+$/.test(cleaned)) return -1;
    const x = cleaned.charCodeAt(0) - 65;
    const y = Number(cleaned.slice(1)) - 1;
    if (x < 0 || y < 0 || x >= size || y >= size) return -1;
    return indexFor(x, y, size);
  }

  function normalizeCells(cells) {
    const minX = Math.min(...cells.map(([x]) => x));
    const minY = Math.min(...cells.map(([, y]) => y));
    return cells
      .map(([x, y]) => [x - minX, y - minY])
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }

  function cellsKey(cells) {
    return normalizeCells(cells).map(([x, y]) => `${x},${y}`).join(";");
  }

  function transformCell(x, y, mode) {
    switch (mode) {
      case 0: return [x, y];
      case 1: return [x, -y];
      case 2: return [-x, y];
      case 3: return [-x, -y];
      case 4: return [y, x];
      case 5: return [y, -x];
      case 6: return [-y, x];
      default: return [-y, -x];
    }
  }

  function trapOrientations(trap) {
    if (orientationCache.has(trap.id)) return orientationCache.get(trap.id);

    const baseShapes = trap.id === "line4"
      ? [trap.cells, [[0, 0], [1, 1], [2, 2], [3, 3]]]
      : [trap.cells];
    const seen = new Set();
    const orientations = [];

    for (const baseCells of baseShapes) {
      for (let mode = 0; mode < 8; mode += 1) {
        const cells = normalizeCells(baseCells.map(([x, y]) => transformCell(x, y, mode)));
        const key = cellsKey(cells);
        if (!seen.has(key)) {
          seen.add(key);
          orientations.push(cells);
        }
      }
    }

    orientationCache.set(trap.id, orientations);
    return orientations;
  }

  function boundsFor(cells) {
    return {
      width: Math.max(...cells.map(([x]) => x)) + 1,
      height: Math.max(...cells.map(([, y]) => y)) + 1,
    };
  }

  function trapPlacements(trap, size = BOARD_SIZE) {
    const cacheKey = `${trap.id}:${size}`;
    if (placementCache.has(cacheKey)) return placementCache.get(cacheKey);

    const placements = [];
    const seen = new Set();
    for (const orientation of trapOrientations(trap)) {
      const { width, height } = boundsFor(orientation);
      for (let oy = 0; oy <= size - height; oy += 1) {
        for (let ox = 0; ox <= size - width; ox += 1) {
          const indices = orientation
            .map(([x, y]) => indexFor(x + ox, y + oy, size))
            .sort((a, b) => a - b);
          const key = indices.join(",");
          if (!seen.has(key)) {
            seen.add(key);
            placements.push(indices);
          }
        }
      }
    }

    placementCache.set(cacheKey, placements);
    return placements;
  }

  function completesTrap(board, player, trapOrId, lastIndex = null, size = BOARD_SIZE) {
    const trap = typeof trapOrId === "string" ? trapById(trapOrId) : trapOrId;
    return trapPlacements(trap, size).some((placement) => {
      if (lastIndex !== null && !placement.includes(lastIndex)) return false;
      return placement.every((index) => board[index] === player);
    });
  }

  function wouldComplete(board, player, trapOrId, index, size = BOARD_SIZE) {
    if (board[index]) return false;
    const next = board.slice();
    next[index] = player;
    return completesTrap(next, player, trapOrId, index, size);
  }

  function wouldLose(board, player, trapOrId, index, size = BOARD_SIZE) {
    if (board[index]) return true;
    return wouldComplete(board, player, trapOrId, index, size);
  }

  function safeMoves(board, player, trapOrId, size = BOARD_SIZE) {
    const moves = [];
    for (let index = 0; index < board.length; index += 1) {
      if (!board[index] && !wouldLose(board, player, trapOrId, index, size)) moves.push(index);
    }
    return moves;
  }

  function openPlacementScore(board, player, trapOrId, size = BOARD_SIZE) {
    const opponent = otherPlayer(player);
    const trap = typeof trapOrId === "string" ? trapById(trapOrId) : trapOrId;
    return trapPlacements(trap, size)
      .reduce((best, placement) => {
        if (placement.some((index) => board[index] === opponent)) return best;
        const pieces = placement.filter((index) => board[index] === player).length;
        return Math.max(best, pieces);
      }, 0);
  }

  function chooseAiMove(
    board,
    trapOrId,
    player = "p2",
    size = BOARD_SIZE,
    difficulty = "standard",
    objective = OBJECTIVE_AVOID
  ) {
    const empties = board.map((value, index) => (value ? null : index)).filter((value) => value !== null);
    if (!empties.length) return -1;

    if (normalizeObjective(objective) === OBJECTIVE_MAKE) {
      const winningMoves = empties.filter((index) => wouldComplete(board, player, trapOrId, index, size));
      if (winningMoves.length) return winningMoves[Math.floor(Math.random() * winningMoves.length)];

      if (difficulty === "practice" && Math.random() < 0.24) {
        return empties[Math.floor(Math.random() * empties.length)];
      }

      const opponent = otherPlayer(player);
      const opponentWins = new Set(
        empties.filter((index) => wouldComplete(board, opponent, trapOrId, index, size))
      );
      const center = (size - 1) / 2;
      const ranked = empties.map((index) => {
        const next = board.slice();
        next[index] = player;
        const ownProgress = openPlacementScore(next, player, trapOrId, size);
        const opponentProgress = openPlacementScore(next, opponent, trapOrId, size);
        const { x, y } = pointForIndex(index, size);
        const distance = Math.abs(x - center) + Math.abs(y - center);
        return {
          index,
          score: (opponentWins.has(index) ? 50 : 0)
            + ownProgress * 5
            - opponentProgress * 1.5
            + (size - distance) * 0.12
            + Math.random() * 0.7,
        };
      });
      ranked.sort((a, b) => b.score - a.score);
      return ranked[0].index;
    }

    if (difficulty === "practice" && Math.random() < 0.24) {
      return empties[Math.floor(Math.random() * empties.length)];
    }

    const safe = safeMoves(board, player, trapOrId, size);
    const candidates = safe.length ? safe : empties;
    const opponent = otherPlayer(player);
    const center = (size - 1) / 2;
    const ranked = candidates.map((index) => {
      const next = board.slice();
      next[index] = player;
      const opponentSafe = safeMoves(next, opponent, trapOrId, size).length;
      const ownSafe = safeMoves(next, player, trapOrId, size).length;
      const { x, y } = pointForIndex(index, size);
      const distance = Math.abs(x - center) + Math.abs(y - center);
      return {
        index,
        score: (size * size - opponentSafe) * 2 + ownSafe * 0.18 + (size - distance) * 0.12 + Math.random() * 0.7,
      };
    });
    ranked.sort((a, b) => b.score - a.score);
    return ranked[0].index;
  }

  function shuffleTrapDeck(random = Math.random, previousTrapId = null) {
    const deck = TRAPS.map((trap) => trap.id);
    for (let index = deck.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
    }
    if (previousTrapId && deck.length > 1 && deck[0] === previousTrapId) {
      [deck[0], deck[1]] = [deck[1], deck[0]];
    }
    return deck;
  }

  function normalizePlayer(player) {
    if (!player) return null;
    if (typeof player === "string") return { name: player.slice(0, 18) };
    const name = String(player.name || "").trim().slice(0, 18);
    return name ? { name } : null;
  }

  function normalizePlayers(players = {}) {
    return {
      p1: normalizePlayer(players.p1),
      p2: normalizePlayer(players.p2),
    };
  }

  function normalizeDeck(deck, previousTrapId = null) {
    const valid = Array.isArray(deck)
      ? deck.filter((id, index) => trapById(id).id === id && deck.indexOf(id) === index)
      : [];
    return valid.length === TRAPS.length ? valid : shuffleTrapDeck(Math.random, previousTrapId);
  }

  function createRoundState(options = {}) {
    const boardSize = Number(options.size || options.boardSize || BOARD_SIZE);
    const requestedTrap = options.trapId && trapById(options.trapId).id === options.trapId
      ? options.trapId
      : null;
    const suppliedDeck = Array.isArray(options.trapDeck);
    const trapDeck = normalizeDeck(options.trapDeck);
    if (requestedTrap && !suppliedDeck) {
      const requestedIndex = trapDeck.indexOf(requestedTrap);
      [trapDeck[0], trapDeck[requestedIndex]] = [trapDeck[requestedIndex], trapDeck[0]];
    }
    const requestedCursor = Number(options.trapCursor || 0);
    const trapCursor = requestedCursor >= 0 && requestedCursor < trapDeck.length ? requestedCursor : 0;
    const starter = PLAYER_ORDER.includes(options.starter)
      ? options.starter
      : PLAYER_ORDER.includes(options.current) ? options.current : "p1";

    return {
      version: 3,
      mode: options.mode || "ai",
      objective: normalizeObjective(options.objective),
      phase: options.phase || "playing",
      board: options.board ? options.board.slice() : emptyBoard(boardSize),
      boardSize,
      current: PLAYER_ORDER.includes(options.current) ? options.current : starter,
      starter,
      trapId: requestedTrap || trapDeck[trapCursor],
      trapDeck,
      trapCursor,
      round: Number(options.round || 1),
      targetWins: Number(options.targetWins || MATCH_TARGET),
      scores: {
        p1: Number(options.scores?.p1 || 0),
        p2: Number(options.scores?.p2 || 0),
      },
      players: normalizePlayers(options.players),
      winner: PLAYER_ORDER.includes(options.winner) ? options.winner : null,
      loser: PLAYER_ORDER.includes(options.loser) ? options.loser : null,
      lastMove: options.lastMove || null,
      moveLog: Array.isArray(options.moveLog) ? options.moveLog.slice() : [],
      rematchVotes: {
        p1: Boolean(options.rematchVotes?.p1),
        p2: Boolean(options.rematchVotes?.p2),
      },
      difficulty: options.difficulty || "standard",
      practice: Boolean(options.practice),
      createdAt: Number(options.createdAt || Date.now()),
      updatedAt: Number(options.updatedAt || Date.now()),
    };
  }

  function normalizeRoomState(room) {
    const state = createRoundState({
      ...room,
      mode: "online",
      phase: room?.phase || "lobby",
      board: Array.isArray(room?.board) ? room.board : emptyBoard(room?.boardSize || BOARD_SIZE),
      size: Number(room?.boardSize || BOARD_SIZE),
    });
    state.board = state.board
      .slice(0, state.boardSize * state.boardSize)
      .map((value) => (PLAYER_ORDER.includes(value) ? value : null));
    while (state.board.length < state.boardSize * state.boardSize) state.board.push(null);
    return state;
  }

  function applyMoveToState(state, index) {
    if (state.phase !== "playing") return state;
    if (index < 0 || index >= state.board.length || state.board[index]) return state;

    const next = {
      ...state,
      board: state.board.slice(),
      scores: { ...state.scores },
      moveLog: state.moveLog.slice(),
      rematchVotes: { p1: false, p2: false },
      updatedAt: Date.now(),
    };
    const player = state.current;
    const opponent = otherPlayer(player);
    const trap = trapById(state.trapId);
    next.board[index] = player;

    const completed = completesTrap(next.board, player, trap, index, state.boardSize);
    const objective = normalizeObjective(state.objective);
    const entry = {
      player,
      index,
      coord: coordForIndex(index, state.boardSize),
      trapId: state.trapId,
      completed,
      lost: completed && objective === OBJECTIVE_AVOID,
      turn: state.moveLog.length + 1,
    };
    next.lastMove = entry;
    next.moveLog.unshift(entry);

    if (completed) {
      const winner = objective === OBJECTIVE_MAKE ? player : opponent;
      const loser = otherPlayer(winner);
      next.scores[winner] += 1;
      next.phase = next.scores[winner] >= next.targetWins ? "matchover" : "roundover";
      next.winner = winner;
      next.loser = loser;
      return next;
    }

    if (next.board.every(Boolean)) {
      next.phase = "roundover";
      next.winner = null;
      next.loser = null;
      return next;
    }

    next.current = opponent;
    return next;
  }

  function nextRoundState(state) {
    let trapDeck = normalizeDeck(state.trapDeck, state.trapId);
    let trapCursor = Number(state.trapCursor || 0) + 1;
    if (trapCursor >= trapDeck.length) {
      trapDeck = shuffleTrapDeck(Math.random, state.trapId);
      trapCursor = 0;
    }
    const starter = otherPlayer(state.starter || "p1");
    return createRoundState({
      mode: state.mode,
      objective: state.objective,
      phase: "playing",
      size: state.boardSize,
      current: starter,
      starter,
      trapDeck,
      trapCursor,
      trapId: trapDeck[trapCursor],
      round: state.round + 1,
      targetWins: state.targetWins,
      scores: state.scores,
      players: state.players,
      difficulty: state.difficulty,
      practice: state.practice,
    });
  }

  function resetMatchState(mode = "ai", players = {}, options = {}) {
    return createRoundState({
      mode,
      phase: mode === "online" ? "lobby" : "playing",
      objective: options.objective,
      players,
      difficulty: options.difficulty || "standard",
      practice: Boolean(options.practice),
      trapDeck: options.trapDeck,
    });
  }

  function applyOnlineActionToState(currentState, seat, action, extra = {}) {
    if (!PLAYER_ORDER.includes(seat)) throw new Error("That player seat is not valid.");
    const room = normalizeRoomState(currentState);

    if (action === "move") {
      const index = Number(extra.index);
      if (!Number.isInteger(index) || index < 0 || index >= room.board.length) {
        throw new Error("That board space is invalid.");
      }
      if (room.phase !== "playing") throw new Error("That round is not active.");
      if (room.current !== seat) throw new Error("It is not your turn.");
      if (room.board[index]) throw new Error("That space is already occupied.");
      return applyMoveToState(room, index);
    }

    if (action === "next-round") {
      if (room.phase !== "roundover") throw new Error("The next round is not ready yet.");
      return nextRoundState(room);
    }

    if (action === "rematch") {
      if (room.phase !== "matchover") throw new Error("The current match is not over.");
      room.rematchVotes[seat] = true;
      if (!room.rematchVotes.p1 || !room.rematchVotes.p2) return room;
      const next = resetMatchState("online", room.players, { objective: room.objective });
      next.phase = "playing";
      return next;
    }

    throw new Error("That room action is not supported.");
  }

  function shouldShowOnlineLobby(mode, phase, hasRoom) {
    return mode === "online" && (!hasRoom || phase === "lobby");
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      BOARD_SIZE,
      MATCH_TARGET,
      OBJECTIVE_AVOID,
      OBJECTIVE_MAKE,
      PLAYER_ORDER,
      TRAPS,
      applyMoveToState,
      applyOnlineActionToState,
      chooseAiMove,
      completesTrap,
      coordForIndex,
      createRoundState,
      emptyBoard,
      indexFor,
      indexForCoord,
      nextRoundState,
      normalizeCells,
      normalizeObjective,
      normalizePlayers,
      normalizeRoomState,
      resetMatchState,
      safeMoves,
      shouldShowOnlineLobby,
      shuffleTrapDeck,
      trapById,
      trapOrientations,
      trapPlacements,
      wouldComplete,
      wouldLose,
    };
  }

  if (typeof document === "undefined") return;

  const els = {};
  [
    "activeTrapLevel", "activeTrapName", "blueScore", "blueScorePanel", "blueSeat", "board",
    "brandHomeButton", "closeRulesButton", "closeSettingsButton", "closeTutorialButton", "confirmAcceptButton",
    "confirmCancelButton", "confirmDialog", "confirmMessage", "confirmTitle", "connectionPill", "connectionText",
    "coordCol", "coordRow", "copyInviteButton", "createRoomButton", "exitGameButton", "gameView", "hintsToggle",
    "homeSubtitle", "homeView", "joinRoomButton", "leaveRoomButton", "lobbyBlueName", "lobbyBlueState", "lobbyRedName",
    "mobileObjectiveLabel", "mobileTrapName", "mobileTrapPreview", "moveCount", "moveLog", "newMatchButton", "objectiveAvoidButton",
    "objectiveDescription", "objectiveMakeButton", "objectivePicker", "onlineBackButton", "onlineNameInput", "onlineSetup",
    "onlineSetupMessage", "onlineTitle", "onlineView", "playAiButton",
    "playLocalButton", "playOnlineButton", "redScore", "redScorePanel", "redSeat", "resultDialog", "resultEyebrow",
    "resultHomeButton", "resultMark", "resultMessage", "resultPrimaryButton", "resultScore", "resultTitle", "resumeButton",
    "resumeText", "roomCodeInput", "roomCodeText", "roundLabel", "rulesButton", "rulesDialog", "scorePips",
    "settingsButton", "settingsDialog", "shareInviteButton", "soundToggle", "statusDetail", "statusText", "toast",
    "trapGallery", "trapMeta", "trapObjectiveLabel", "trapPreview", "trapRule", "tutorialDialog", "tutorialGoalText",
    "tutorialGoalTitle", "tutorialPlayButton", "tutorialResultText", "tutorialTitle", "turnBanner",
    "waitingMessage", "waitingRoom", "waitingTitle",
  ].forEach((id) => { els[id] = document.getElementById(id); });

  const defaultPlayers = {
    ai: { p1: { name: "You" }, p2: { name: "Computer" } },
    local: { p1: { name: "Red" }, p2: { name: "Blue" } },
    online: { p1: { name: "Red" }, p2: null },
  };

  let state = resetMatchState("ai", defaultPlayers.ai);
  let currentView = "home";
  let activeMatch = false;
  let aiTimer = null;
  let toastTimer = null;
  let resultKey = "";
  let confirmAction = null;
  let savedMatch = loadSavedMatch();
  const preferences = loadPreferences();
  let selectedObjective = normalizeObjective(preferences.objective);
  const online = {
    actionTimer: null,
    authorized: false,
    busy: false,
    client: null,
    config: null,
    connection: "offline",
    connectionGeneration: 0,
    guestToken: "",
    joinTimer: null,
    pendingGuestToken: "",
    pollTimer: null,
    ready: false,
    reconnectTimer: null,
    rev: 0,
    room: null,
    roomId: "",
    seat: null,
    subscription: null,
    token: "",
  };

  function cleanName(value, fallback = "Player") {
    const cleaned = String(value || "").trim().slice(0, 18);
    return cleaned || fallback;
  }

  function renderObjectiveSelector() {
    const makeShapes = selectedObjective === OBJECTIVE_MAKE;
    els.objectivePicker.dataset.objective = selectedObjective;
    els.objectiveAvoidButton.classList.toggle("is-active", !makeShapes);
    els.objectiveMakeButton.classList.toggle("is-active", makeShapes);
    els.objectiveAvoidButton.setAttribute("aria-pressed", String(!makeShapes));
    els.objectiveMakeButton.setAttribute("aria-pressed", String(makeShapes));
    els.homeSubtitle.textContent = makeShapes
      ? "Build the shown shape in your color before your opponent."
      : "Place your color without completing the shape shown for the round.";
    els.objectiveDescription.textContent = makeShapes
      ? "Complete the shape in your color and you win the round."
      : "Complete the shape in your color and you lose the round.";
    els.tutorialTitle.textContent = makeShapes
      ? "Complete the shape before they do."
      : "Build pressure, not the trap.";
    els.tutorialResultText.textContent = makeShapes ? "That red move wins." : "That red move loses.";
    els.tutorialGoalTitle.textContent = makeShapes ? "Finish it first." : "Make them finish it.";
    els.tutorialGoalText.textContent = makeShapes
      ? "Completing the pattern in your own color wins the round."
      : "Completing the pattern in your own color loses the round.";
  }

  function selectObjective(value) {
    selectedObjective = normalizeObjective(value);
    preferences.objective = selectedObjective;
    savePreferences();
    renderObjectiveSelector();
  }

  function playerNames() {
    const fallback = defaultPlayers[state.mode] || defaultPlayers.local;
    return {
      p1: state.players.p1?.name || fallback.p1?.name || "Red",
      p2: state.players.p2?.name || fallback.p2?.name || "Blue",
    };
  }

  function playerLabel(player) {
    return playerNames()[player] || PLAYER_INFO[player].color;
  }

  function loadPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_SETTINGS) || "{}");
      return {
        sound: saved.sound !== false,
        hints: Boolean(saved.hints),
        tutorialSeen: Boolean(saved.tutorialSeen),
        objective: normalizeObjective(saved.objective),
      };
    } catch {
      return { sound: true, hints: false, tutorialSeen: false, objective: OBJECTIVE_AVOID };
    }
  }

  function savePreferences() {
    try {
      localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(preferences));
    } catch {
      // Preferences are optional when storage is unavailable.
    }
  }

  function loadSavedMatch() {
    try {
      const payload = JSON.parse(localStorage.getItem(STORAGE_MATCH) || "null");
      if (!payload?.state || !["ai", "local"].includes(payload.state.mode)) return null;
      const restored = createRoundState(payload.state);
      if (restored.boardSize !== BOARD_SIZE) return null;
      return restored;
    } catch {
      return null;
    }
  }

  function persistLocalMatch() {
    if (!["ai", "local"].includes(state.mode)) return;
    savedMatch = createRoundState(state);
    try {
      localStorage.setItem(STORAGE_MATCH, JSON.stringify({ state: savedMatch, savedAt: Date.now() }));
    } catch {
      // A match can continue without persistence.
    }
  }

  function clearSavedMatch() {
    savedMatch = null;
    try {
      localStorage.removeItem(STORAGE_MATCH);
    } catch {
      // Storage may be blocked.
    }
  }

  function showView(view) {
    currentView = view;
    els.homeView.classList.toggle("is-hidden", view !== "home");
    els.onlineView.classList.toggle("is-hidden", view !== "online");
    els.gameView.classList.toggle("is-hidden", view !== "game");
    els.exitGameButton.classList.toggle("is-hidden", view !== "game");
    renderConnection();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function goHome() {
    clearTimeout(aiTimer);
    closeDialog(els.resultDialog);
    closeDialog(els.confirmDialog);
    activeMatch = false;
    showView("home");
    renderHome();
  }

  function startLocalMatch(mode, options = {}) {
    leaveOnlineRoom(false);
    const players = mode === "ai" ? defaultPlayers.ai : defaultPlayers.local;
    state = resetMatchState(mode, players, {
      ...options,
      objective: options.objective || selectedObjective,
    });
    activeMatch = true;
    resultKey = "";
    showView("game");
    persistLocalMatch();
    render();
    scheduleAiIfNeeded();
  }

  function resumeMatch() {
    if (online.roomId && online.room && state.mode === "online" && state.phase !== "lobby") {
      activeMatch = true;
      showView("game");
      render();
      return;
    }
    if (!savedMatch) return;
    state = createRoundState(savedMatch);
    activeMatch = true;
    resultKey = "";
    showView("game");
    render();
    scheduleAiIfNeeded();
  }

  function startAiFlow() {
    if (!preferences.tutorialSeen) {
      openDialog(els.tutorialDialog);
      return;
    }
    startLocalMatch("ai");
  }

  function handleCellClick(index) {
    if (state.phase !== "playing" || state.board[index]) return;
    if (state.mode === "online") {
      playOnlineMove(index);
      return;
    }
    if (state.mode === "ai" && state.current !== "p1") return;

    state = applyMoveToState(state, index);
    playFeedback(state.phase === "playing" ? "move" : state.winner === "p1" ? "win" : "loss");
    persistLocalMatch();
    render();
    scheduleAiIfNeeded();
  }

  function scheduleAiIfNeeded() {
    clearTimeout(aiTimer);
    if (state.mode !== "ai" || state.phase !== "playing" || state.current !== "p2") return;
    aiTimer = setTimeout(() => {
      const move = chooseAiMove(
        state.board,
        state.trapId,
        "p2",
        state.boardSize,
        state.difficulty,
        state.objective
      );
      if (move < 0) return;
      state = applyMoveToState(state, move);
      playFeedback(state.phase === "playing" ? "move" : state.winner === "p1" ? "win" : "loss");
      persistLocalMatch();
      render();
    }, state.practice ? 520 : 380);
  }

  function startNextRound() {
    closeDialog(els.resultDialog);
    resultKey = "";
    if (state.mode === "online") {
      mutateOnline("next-round");
      return;
    }
    state = nextRoundState(state);
    persistLocalMatch();
    render();
    showToast(`${trapById(state.trapId).shortName} drawn.`);
    scheduleAiIfNeeded();
  }

  function rematch() {
    if (state.mode === "online") {
      mutateOnline("rematch");
      return;
    }
    closeDialog(els.resultDialog);
    const mode = state.mode;
    const players = state.players;
    state = resetMatchState(mode, players, {
      difficulty: state.difficulty,
      practice: state.practice,
      objective: state.objective,
    });
    resultKey = "";
    persistLocalMatch();
    render();
  }

  function requestNewMatch() {
    if (state.mode === "online") return;
    if (!state.moveLog.length && state.round === 1) {
      restartLocalMatch();
      return;
    }
    confirmAction = restartLocalMatch;
    els.confirmTitle.textContent = "Start a new match?";
    els.confirmMessage.textContent = "The current score and board will be cleared.";
    els.confirmAcceptButton.textContent = "Start over";
    openDialog(els.confirmDialog);
  }

  function restartLocalMatch() {
    closeDialog(els.confirmDialog);
    const mode = state.mode;
    const players = state.players;
    state = resetMatchState(mode, players, {
      difficulty: state.difficulty,
      practice: state.practice,
      objective: state.objective,
    });
    resultKey = "";
    persistLocalMatch();
    render();
    scheduleAiIfNeeded();
  }

  function render() {
    renderHome();
    if (currentView === "online") renderOnline();
    if (currentView !== "game") return;
    renderMatchBar();
    renderStatus();
    renderTrap();
    renderBoard();
    renderMoveLog();
    renderConnection();
    maybeShowResult();
  }

  function renderHome() {
    renderObjectiveSelector();
    const canResumeOnline = Boolean(
      online.roomId && online.room && state.mode === "online" && state.phase !== "lobby"
    );
    const canResumeLocal = Boolean(savedMatch && savedMatch.phase !== "matchover");
    const canResume = canResumeOnline || canResumeLocal;
    els.resumeButton.classList.toggle("is-hidden", !canResume);
    if (canResumeOnline) {
      const turn = online.seat === state.current ? "your turn" : `${playerLabel(state.current)}'s turn`;
      els.resumeText.textContent = `Online room ${online.roomId} | ${turn}`;
    } else if (canResumeLocal) {
      const mode = savedMatch.mode === "ai" ? "Computer match" : "Pass & play";
      els.resumeText.textContent = `${mode} | round ${savedMatch.round}`;
    }
  }

  function renderMatchBar() {
    const names = playerNames();
    els.redSeat.textContent = names.p1 + (state.mode === "online" && online.seat === "p1" ? " (you)" : "");
    els.blueSeat.textContent = names.p2 + (state.mode === "online" && online.seat === "p2" ? " (you)" : "");
    els.gameView.dataset.seat = state.mode === "online" ? online.seat || "" : "local";
    els.redScore.textContent = String(state.scores.p1);
    els.blueScore.textContent = String(state.scores.p2);
    els.roundLabel.textContent = `Round ${state.round} | first to ${state.targetWins}`;
    els.redScorePanel.classList.toggle("is-turn", state.phase === "playing" && state.current === "p1");
    els.blueScorePanel.classList.toggle("is-turn", state.phase === "playing" && state.current === "p2");
    els.newMatchButton.classList.toggle("is-hidden", state.mode === "online");

    els.scorePips.innerHTML = "";
    for (let index = 0; index < state.targetWins; index += 1) {
      const red = document.createElement("span");
      red.className = `score-pip${index < state.scores.p1 ? " is-red" : ""}`;
      const blue = document.createElement("span");
      blue.className = `score-pip${index < state.scores.p2 ? " is-blue" : ""}`;
      els.scorePips.append(red, blue);
    }
  }

  function renderStatus() {
    const names = playerNames();
    const player = state.current;
    els.turnBanner.classList.toggle("is-blue", player === "p2");

    if (state.phase !== "playing") {
      els.statusText.textContent = state.phase === "matchover" ? "Match complete" : "Round complete";
      els.statusDetail.textContent = "Review the result to continue.";
      return;
    }

    if (state.mode === "online" && online.seat !== player) {
      els.statusText.textContent = `${names[player]}'s turn`;
      els.statusDetail.textContent = "Waiting for their move.";
    } else if (state.mode === "ai" && player === "p2") {
      els.statusText.textContent = "Computer is thinking";
      els.statusDetail.textContent = state.objective === OBJECTIVE_MAKE
        ? "It is building the shape."
        : "It is looking for pressure.";
    } else {
      els.statusText.textContent = player === "p1" && state.mode === "ai" ? "Your turn" : `${names[player]}'s turn`;
      els.statusDetail.textContent = state.objective === OBJECTIVE_MAKE
        ? `Build with ${PLAYER_INFO[player].color.toLowerCase()}.`
        : `Place one ${PLAYER_INFO[player].color.toLowerCase()} piece safely.`;
    }
  }

  function renderCoordinates() {
    els.coordRow.innerHTML = "<span></span>";
    els.coordCol.innerHTML = "";
    for (let index = 0; index < state.boardSize; index += 1) {
      const file = document.createElement("span");
      file.textContent = String.fromCharCode(65 + index);
      els.coordRow.appendChild(file);
      const rank = document.createElement("span");
      rank.textContent = String(index + 1);
      els.coordCol.appendChild(rank);
    }
  }

  function renderBoard() {
    renderCoordinates();
    els.board.style.setProperty("--board-size", state.boardSize);
    els.board.setAttribute("aria-label", `${state.boardSize} by ${state.boardSize} Color Trap board`);
    els.board.innerHTML = "";
    const canControl = state.mode !== "online" || (online.seat === state.current && !online.busy);
    const showHints = (state.practice || preferences.hints) && canControl && state.phase === "playing";

    state.board.forEach((cell, index) => {
      const button = document.createElement("button");
      const coord = coordForIndex(index, state.boardSize);
      const disabled = state.phase !== "playing" || Boolean(cell) || !canControl || (state.mode === "ai" && state.current !== "p1");
      button.className = "board-cell";
      button.type = "button";
      button.disabled = disabled;
      button.dataset.index = String(index);
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-rowindex", String(Math.floor(index / state.boardSize) + 1));
      button.setAttribute("aria-colindex", String((index % state.boardSize) + 1));
      button.setAttribute("aria-label", cell ? `${coord}, ${PLAYER_INFO[cell].color}` : `${coord}, empty`);
      button.classList.toggle("is-last", state.lastMove?.index === index);
      button.classList.toggle("is-hint", showHints && !cell && wouldLose(state.board, state.current, state.trapId, index, state.boardSize));

      if (cell) {
        const stone = document.createElement("span");
        stone.className = `stone stone-${cell}`;
        const token = document.createElement("span");
        token.textContent = PLAYER_INFO[cell].token;
        stone.appendChild(token);
        button.appendChild(stone);
      }
      button.addEventListener("click", () => handleCellClick(index));
      els.board.appendChild(button);
    });
  }

  function fillTrapPreview(container, trap, compact = false) {
    const cells = normalizeCells(trap.cells);
    const { width, height } = boundsFor(cells);
    const occupied = new Set(cells.map(([x, y]) => `${x}:${y}`));
    container.style.gridTemplateColumns = `repeat(${width}, 1fr)`;
    container.innerHTML = "";
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const dot = document.createElement("span");
        dot.className = occupied.has(`${x}:${y}`) ? "trap-dot is-filled" : "trap-dot";
        if (compact) dot.setAttribute("aria-hidden", "true");
        container.appendChild(dot);
      }
    }
  }

  function renderTrap() {
    const trap = trapById(state.trapId);
    const makeShapes = state.objective === OBJECTIVE_MAKE;
    els.activeTrapName.textContent = trap.shortName;
    els.activeTrapLevel.textContent = trap.level;
    els.trapMeta.textContent = trap.meta;
    els.trapRule.textContent = trap.rule;
    els.trapObjectiveLabel.textContent = makeShapes ? "Make this shape" : "Avoid this shape";
    els.mobileObjectiveLabel.textContent = makeShapes ? "Make" : "Avoid";
    els.mobileTrapName.textContent = trap.shortName;
    fillTrapPreview(els.trapPreview, trap);
    fillTrapPreview(els.mobileTrapPreview, trap, true);
  }

  function renderMoveLog() {
    const names = playerNames();
    els.moveCount.textContent = `${state.moveLog.length} played`;
    els.moveLog.innerHTML = "";
    if (!state.moveLog.length) {
      const empty = document.createElement("li");
      empty.className = "log-empty";
      empty.textContent = "No moves yet";
      els.moveLog.appendChild(empty);
      return;
    }
    state.moveLog.slice(0, 16).forEach((entry) => {
      const item = document.createElement("li");
      item.className = "log-item";
      const token = document.createElement("span");
      token.className = `log-stone log-${entry.player}`;
      token.textContent = PLAYER_INFO[entry.player].token;
      const text = document.createElement("span");
      text.textContent = (entry.completed ?? entry.lost)
        ? `${names[entry.player]} completed ${trapById(entry.trapId).shortName} at ${entry.coord}`
        : `${names[entry.player]} placed ${entry.coord}`;
      item.append(token, text);
      els.moveLog.appendChild(item);
    });
  }

  function maybeShowResult() {
    if (!["roundover", "matchover"].includes(state.phase)) return;
    const key = `${state.phase}:${state.round}:${state.scores.p1}:${state.scores.p2}:${state.lastMove?.turn || "draw"}:${state.rematchVotes.p1}:${state.rematchVotes.p2}`;
    const wasOpen = els.resultDialog.open;
    if (resultKey === key && wasOpen) return;
    resultKey = key;
    const names = playerNames();
    const isMatch = state.phase === "matchover";
    const winner = state.winner;
    els.resultMark.className = "result-mark";

    if (winner) {
      els.resultMark.textContent = PLAYER_INFO[winner].token;
      els.resultMark.classList.toggle("is-blue", winner === "p2");
      els.resultEyebrow.textContent = isMatch ? "Match winner" : "Round complete";
      els.resultTitle.textContent = `${names[winner]} wins${isMatch ? " the match" : " the round"}`;
      const completingPlayer = state.objective === OBJECTIVE_MAKE ? state.winner : state.loser;
      els.resultMessage.textContent = `${names[completingPlayer]} completed ${trapById(state.trapId).shortName} at ${state.lastMove?.coord || "the final space"}.`;
    } else {
      els.resultMark.textContent = "=";
      els.resultMark.classList.add("is-draw");
      els.resultEyebrow.textContent = "Board complete";
      els.resultTitle.textContent = "Round drawn";
      els.resultMessage.textContent = "The board filled without either color completing the trap.";
    }

    els.resultScore.textContent = `${names.p1} ${state.scores.p1} | ${names.p2} ${state.scores.p2}`;
    els.resultPrimaryButton.textContent = isMatch ? "Ready for rematch" : "Next round";
    els.resultPrimaryButton.disabled = isMatch && state.mode === "online" && Boolean(state.rematchVotes?.[online.seat]);
    if (els.resultPrimaryButton.disabled) els.resultPrimaryButton.textContent = "Waiting for opponent";
    if (!els.resultDialog.open) els.resultDialog.show();
    if (!wasOpen) {
      playFeedback(winner === online.seat || (state.mode !== "online" && winner === "p1") ? "win" : "loss");
    }
  }

  function renderTrapGallery() {
    els.trapGallery.innerHTML = "";
    TRAPS.forEach((trap) => {
      const item = document.createElement("div");
      item.className = "trap-gallery-item";
      const preview = document.createElement("div");
      preview.className = "mini-trap-preview";
      fillTrapPreview(preview, trap, true);
      const name = document.createElement("span");
      name.textContent = trap.shortName;
      item.append(preview, name);
      els.trapGallery.appendChild(item);
    });
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
  }

  function playFeedback(kind) {
    if (navigator.vibrate && ["win", "loss"].includes(kind)) navigator.vibrate(kind === "win" ? [30, 40, 50] : [70]);
    if (!preferences.sound) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const frequency = kind === "win" ? 620 : kind === "loss" ? 180 : 280;
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      if (kind === "win") oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.04, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.14);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.15);
      oscillator.addEventListener("ended", () => context.close());
    } catch {
      // Audio feedback is optional.
    }
  }

  function cleanRoomId(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ROOM_ID_LENGTH);
  }

  function randomOnlineId(alphabet, length) {
    const bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
  }

  function createRoomId() {
    return randomOnlineId(ROOM_ID_ALPHABET, ROOM_ID_LENGTH);
  }

  function createOnlineToken() {
    return randomOnlineId("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 30);
  }

  function roomStorageKey(roomId) {
    return `colorTrapRoom:${roomId}`;
  }

  function getStoredRoom(roomId) {
    try {
      return JSON.parse(localStorage.getItem(roomStorageKey(roomId)) || "null");
    } catch {
      return null;
    }
  }

  function storeRoomAccess(roomId, token, seat, name = "Player", details = {}) {
    try {
      const previous = getStoredRoom(roomId) || {};
      localStorage.setItem(roomStorageKey(roomId), JSON.stringify({
        ...previous,
        token,
        seat,
        name,
        ...details,
      }));
    } catch {
      // Reconnect is optional when storage is unavailable.
    }
  }

  function clearRoomAccess(roomId) {
    try {
      localStorage.removeItem(roomStorageKey(roomId));
    } catch {
      // Storage may be unavailable.
    }
  }

  async function openOnlineView() {
    if (online.roomId && online.room) {
      if (online.room.phase === "lobby") {
        showView("online");
        renderOnline();
      } else {
        activeMatch = true;
        showView("game");
        render();
      }
      return;
    }
    activeMatch = false;
    showView("online");
    els.onlineSetup.classList.remove("is-hidden");
    els.waitingRoom.classList.add("is-hidden");
    renderOnline();
    await prepareOnlineMode();
  }

  async function prepareOnlineMode() {
    els.createRoomButton.disabled = true;
    els.joinRoomButton.disabled = true;
    setOnlineMessage("Checking online play...");
    try {
      const response = await fetch("/api/supabase-config", { cache: "no-store" });
      const payload = response.ok ? await response.json() : {};
      if (!payload.configured || !payload.config?.url || !payload.config?.anonKey) {
        throw new Error("Online play is not connected in this preview yet.");
      }
      if (!window.supabase?.createClient) throw new Error("Online play could not load. Refresh and try again.");
      online.config = payload.config;
      online.client = window.supabase.createClient(payload.config.url, payload.config.anonKey);
      online.ready = true;
      els.createRoomButton.disabled = false;
      els.joinRoomButton.disabled = false;
      setOnlineMessage("Live rooms are ready and start automatically when both players arrive.");
      return true;
    } catch (error) {
      online.ready = false;
      setOnlineMessage(error.message || "Online play is temporarily unavailable.", true);
      return false;
    }
  }

  function setOnlineMessage(message, isError = false) {
    els.onlineSetupMessage.textContent = message;
    els.onlineSetupMessage.classList.toggle("is-error", isError);
  }

  async function createOnlineRoom() {
    if (!online.ready || online.busy) return;
    online.busy = true;
    renderOnline();
    try {
      const roomId = createRoomId();
      const token = createOnlineToken();
      const room = resetMatchState("online", {
        p1: { name: cleanName(els.onlineNameInput.value) },
        p2: null,
      }, { objective: selectedObjective });
      online.authorized = true;
      online.guestToken = "";
      applyOnlinePayload({ roomId, room: { state: room, rev: 0 }, seat: "p1", token });
      updateRoomUrl(online.roomId);
      await connectOnlineRoom();
      showToast("Room created. Invite a friend.");
    } catch (error) {
      setOnlineMessage(error.message, true);
      showToast("Could not create the room.");
    } finally {
      online.busy = false;
      render();
    }
  }

  async function joinOnlineRoom(rawRoomId) {
    const roomId = cleanRoomId(rawRoomId);
    if (roomId.length !== ROOM_ID_LENGTH) {
      setOnlineMessage("Enter the complete six-character room code.", true);
      return;
    }
    if (!online.ready || online.busy) return;
    let waitingForHost = false;
    online.busy = true;
    renderOnline();
    try {
      const stored = getStoredRoom(roomId);
      if (stored?.seat === "p1" && stored.room && stored.token) {
        online.authorized = true;
        online.guestToken = String(stored.guestToken || "");
        applyOnlinePayload({
          roomId,
          room: { state: stored.room, rev: Number(stored.rev || 0) },
          seat: "p1",
          token: stored.token,
        });
        updateRoomUrl(roomId);
        await connectOnlineRoom();
        showToast("Hosted room reopened.");
        return;
      }

      online.roomId = roomId;
      online.room = null;
      online.rev = 0;
      online.seat = "p2";
      online.token = stored?.seat === "p2" && stored.token ? stored.token : createOnlineToken();
      online.authorized = false;
      online.guestToken = "";
      storeRoomAccess(roomId, online.token, "p2", cleanName(els.onlineNameInput.value));
      updateRoomUrl(roomId);
      setOnlineMessage("Connecting to the host...");
      await connectOnlineRoom();
      waitingForHost = true;
    } catch (error) {
      setOnlineMessage(error.message, true);
      showToast(error.message);
    } finally {
      if (!waitingForHost || online.authorized) online.busy = false;
      render();
    }
  }

  function applyOnlinePayload(payload) {
    if (!payload?.room) return;
    const stayOnHome = currentView === "home";
    online.roomId = cleanRoomId(payload.roomId || payload.id || online.roomId);
    online.room = normalizeRoomState(payload.room.state || payload.room);
    online.rev = Number(payload.room.rev ?? payload.rev ?? online.rev);
    if (selectedObjective !== online.room.objective) {
      selectedObjective = online.room.objective;
      preferences.objective = selectedObjective;
      savePreferences();
      renderObjectiveSelector();
    }
    if (payload.seat) online.seat = payload.seat;
    if (payload.token) online.token = payload.token;
    if ((!online.seat || !online.token) && online.roomId) {
      const stored = getStoredRoom(online.roomId);
      if (!online.seat && PLAYER_ORDER.includes(stored?.seat)) online.seat = stored.seat;
      if (!online.token && stored?.token) online.token = stored.token;
    }
    if (online.roomId && online.token && online.seat) {
      const name = online.room.players[online.seat]?.name || "Player";
      const details = { room: online.room, rev: online.rev };
      if (online.seat === "p1") details.guestToken = online.guestToken;
      storeRoomAccess(online.roomId, online.token, online.seat, name, details);
    }
    state = { ...online.room, mode: "online" };
    if (state.phase === "playing") {
      closeDialog(els.resultDialog);
      resultKey = "";
    }
    if (state.phase === "lobby") {
      activeMatch = false;
      if (!stayOnHome) showView("online");
    } else {
      activeMatch = true;
      if (!stayOnHome) showView("game");
    }
    if (stayOnHome) renderHome();
  }

  async function connectOnlineRoom() {
    disconnectOnlineTransport();
    if (!online.roomId) return;
    if (!online.client) throw new Error("Online play could not connect. Refresh and try again.");
    const generation = online.connectionGeneration;
    setConnection("connecting");

    const channel = online.client
      .channel(`color-trap-room-${online.roomId}`, {
        config: {
          broadcast: { ack: true, self: false },
          presence: { key: online.token },
        },
      })
      .on("broadcast", { event: "room-join" }, handleJoinRequest)
      .on("broadcast", { event: "room-state" }, handleRemoteState)
      .on("broadcast", { event: "room-action" }, handleActionRequest)
      .on("broadcast", { event: "room-state-request" }, handleStateRequest)
      .on("broadcast", { event: "room-error" }, handleRemoteError)
      .on("broadcast", { event: "room-closed" }, handleRoomClosed)
      .on("presence", { event: "sync" }, handlePresenceSync)
      .on("presence", { event: "join" }, handlePresenceJoin);

    online.subscription = channel;
    channel.subscribe((status) => {
      if (generation !== online.connectionGeneration || online.subscription !== channel) return;
      if (status === "SUBSCRIBED") {
        setConnection("live");
        trackOnlinePresence(channel, generation);
        if (online.seat === "p1") broadcastRoomState().catch(() => {});
        else requestOnlineJoin();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        setConnection("offline");
        scheduleOnlineReconnect();
      }
    });

    online.pollTimer = setInterval(pollOnlineRoom, ROOM_SYNC_INTERVAL_MS);
  }

  function disconnectOnlineTransport() {
    online.connectionGeneration += 1;
    if (online.subscription && online.client) online.client.removeChannel(online.subscription);
    online.subscription = null;
    clearTimeout(online.reconnectTimer);
    online.reconnectTimer = null;
    clearTimeout(online.joinTimer);
    online.joinTimer = null;
    clearInterval(online.pollTimer);
    online.pollTimer = null;
  }

  function scheduleOnlineReconnect(delay = ROOM_RECONNECT_DELAY_MS) {
    if (!online.roomId || !online.ready || online.reconnectTimer) return;
    online.reconnectTimer = setTimeout(() => {
      online.reconnectTimer = null;
      if (!online.roomId || !online.ready) return;
      connectOnlineRoom().catch(() => {
        setConnection("offline");
        scheduleOnlineReconnect(ROOM_RECONNECT_DELAY_MS * 2);
      });
    }, delay);
  }

  function ensureOnlineConnection() {
    if (!online.roomId || !online.ready) return;
    if (online.connection === "live" && online.subscription) {
      pollOnlineRoom();
      return;
    }
    scheduleOnlineReconnect(0);
  }

  function trackOnlinePresence(channel, generation) {
    const name = online.room?.players?.[online.seat]?.name || cleanName(els.onlineNameInput.value);
    channel.track({
      roomId: online.roomId,
      seat: online.seat,
      token: online.token,
      name,
    }).then((status) => {
      if (generation !== online.connectionGeneration || status === "ok") return;
      scheduleOnlineReconnect();
    }).catch(() => scheduleOnlineReconnect());
  }

  function handlePresenceSync() {
    if (!online.subscription || !online.roomId) return;
    const presenceState = online.subscription.presenceState?.() || {};
    handlePresencePlayers(Object.values(presenceState).flat());
  }

  function handlePresenceJoin(event) {
    handlePresencePlayers(event?.newPresences || []);
  }

  function handlePresencePlayers(presences) {
    const players = presences.filter((presence) => (
      cleanRoomId(presence.roomId) === online.roomId && presence.token
    ));

    if (online.seat === "p1") {
      players
        .filter((presence) => presence.seat === "p2" && presence.token !== online.token)
        .forEach((presence) => handleJoinRequest({ payload: presence }));
      return;
    }

    const hostIsPresent = players.some((presence) => presence.seat === "p1");
    if (hostIsPresent && !online.authorized) {
      setOnlineMessage("Host found. Joining the match...");
      requestOnlineJoin();
    }
  }

  function onlineEventPayload(message) {
    return message?.payload || message || {};
  }

  async function broadcastOnline(event, payload = {}) {
    if (!online.subscription || online.connection !== "live") {
      throw new Error("The room is reconnecting. Try again in a moment.");
    }
    const result = await online.subscription.send({
      type: "broadcast",
      event,
      payload: { roomId: online.roomId, ...payload },
    });
    if (result && result !== "ok") throw new Error("The room did not receive that update.");
  }

  function broadcastRoomState(target = "") {
    if (online.seat !== "p1" || !online.room) return Promise.resolve();
    return broadcastOnline("room-state", {
      target,
      rev: online.rev,
      state: online.room,
    });
  }

  function requestOnlineJoin() {
    if (online.seat !== "p2" || !online.token || online.connection !== "live") return;
    broadcastOnline("room-join", {
      token: online.token,
      name: cleanName(els.onlineNameInput.value),
    }).catch(() => {
      setConnection("offline");
      scheduleOnlineReconnect();
    });

    if (!online.joinTimer && !online.authorized) {
      online.joinTimer = setTimeout(() => {
        online.joinTimer = null;
        if (online.authorized) return;
        online.busy = false;
        setOnlineMessage("Still trying to reach the host. Keep both game pages open and they will reconnect automatically.", true);
        renderOnline();
      }, ROOM_JOIN_TIMEOUT_MS);
    }
  }

  async function commitHostState(nextState, target = "") {
    if (online.seat !== "p1") return;
    online.rev += 1;
    applyOnlinePayload({
      roomId: online.roomId,
      room: { state: nextState, rev: online.rev },
      seat: "p1",
      token: online.token,
    });
    online.busy = false;
    render();
    await broadcastRoomState(target);
  }

  function sendOnlineError(target, message) {
    return broadcastOnline("room-error", { target, message }).catch(() => {});
  }

  async function handleJoinRequest(message) {
    if (online.seat !== "p1" || !online.room) return;
    const payload = onlineEventPayload(message);
    if (cleanRoomId(payload.roomId) !== online.roomId) return;
    const token = String(payload.token || "");
    if (!token) return;

    if (online.pendingGuestToken === token) return;
    online.pendingGuestToken = token;

    try {
      const next = normalizeRoomState(online.room);
      if (next.players.p2 && online.guestToken && token !== online.guestToken) {
        await sendOnlineError(token, "That room already has two players.");
        return;
      }

      if (!online.guestToken) online.guestToken = token;
      const name = cleanName(payload.name, "Blue");
      const changed = !next.players.p2 || next.players.p2.name !== name || next.phase === "lobby";
      next.players.p2 = { name };
      if (next.players.p1 && next.players.p2 && next.phase === "lobby") {
        next.phase = "playing";
        next.current = next.starter || "p1";
      }

      if (changed) await commitHostState(next, token);
      else await broadcastRoomState(token);
    } finally {
      if (online.pendingGuestToken === token) online.pendingGuestToken = "";
    }
  }

  function handleRemoteState(message) {
    if (online.seat !== "p2") return;
    const payload = onlineEventPayload(message);
    if (cleanRoomId(payload.roomId) !== online.roomId || !payload.state) return;
    const target = String(payload.target || "");
    if (target && target !== online.token) return;
    if (!online.authorized && target !== online.token) {
      setOnlineMessage("Host found. Joining the match...");
      requestOnlineJoin();
      return;
    }
    const rev = Number(payload.rev || 0);
    if (online.authorized && rev < online.rev) return;

    const firstState = !online.authorized;
    online.authorized = true;
    online.busy = false;
    clearTimeout(online.actionTimer);
    online.actionTimer = null;
    clearTimeout(online.joinTimer);
    online.joinTimer = null;
    applyOnlinePayload({ roomId: online.roomId, room: { state: payload.state, rev } });
    setConnection("live");
    render();
    if (firstState) showToast("Joined the room.");
  }

  async function handleActionRequest(message) {
    if (online.seat !== "p1" || !online.room) return;
    const payload = onlineEventPayload(message);
    if (cleanRoomId(payload.roomId) !== online.roomId) return;
    const token = String(payload.token || "");
    if (!token || token !== online.guestToken) {
      if (token) await sendOnlineError(token, "That player is not seated in this room.");
      return;
    }
    try {
      const next = applyOnlineActionToState(online.room, "p2", payload.action, payload.extra || {});
      await commitHostState(next);
    } catch (error) {
      await sendOnlineError(token, error.message || "That move could not be played.");
    }
  }

  function handleStateRequest(message) {
    if (online.seat !== "p1" || !online.room) return;
    const payload = onlineEventPayload(message);
    if (cleanRoomId(payload.roomId) !== online.roomId) return;
    if (String(payload.token || "") !== online.guestToken) return;
    broadcastRoomState(online.guestToken).catch(() => {});
  }

  function handleRemoteError(message) {
    if (online.seat !== "p2") return;
    const payload = onlineEventPayload(message);
    if (cleanRoomId(payload.roomId) !== online.roomId || String(payload.target || "") !== online.token) return;
    online.busy = false;
    clearTimeout(online.actionTimer);
    online.actionTimer = null;
    const messageText = String(payload.message || "The room could not complete that action.");
    setOnlineMessage(messageText, true);
    showToast(messageText);
    if (!online.authorized) {
      disconnectOnlineTransport();
      setConnection("offline");
    }
    render();
  }

  function handleRoomClosed(message) {
    if (online.seat !== "p2") return;
    const payload = onlineEventPayload(message);
    if (cleanRoomId(payload.roomId) !== online.roomId) return;
    const closedRoomId = online.roomId;
    leaveOnlineRoom(false);
    clearRoomAccess(closedRoomId);
    showView("online");
    renderOnline();
    setOnlineMessage("The host closed this room.", true);
  }

  async function pollOnlineRoom() {
    if (!online.roomId) return;
    if (online.connection !== "live") {
      scheduleOnlineReconnect();
      return;
    }
    try {
      if (online.seat === "p1") await broadcastRoomState();
      else if (online.authorized) {
        await broadcastOnline("room-state-request", { token: online.token });
      } else {
        requestOnlineJoin();
      }
    } catch {
      setConnection("offline");
    }
  }

  function setConnection(status) {
    online.connection = status;
    renderConnection();
  }

  function renderConnection() {
    const show = Boolean(online.roomId && ["online", "game"].includes(currentView));
    els.connectionPill.classList.toggle("is-hidden", !show);
    els.connectionPill.classList.toggle("is-live", statusIs("live"));
    els.connectionPill.classList.toggle("is-offline", statusIs("offline"));
    els.connectionText.textContent = online.connection === "live"
      ? "Live"
      : online.connection === "connecting" ? "Connecting" : "Reconnecting";
  }

  function statusIs(status) {
    return online.connection === status;
  }

  function renderOnline() {
    const hasRoom = Boolean(online.roomId && online.room);
    els.onlineSetup.classList.toggle("is-hidden", hasRoom);
    els.waitingRoom.classList.toggle("is-hidden", !hasRoom);
    els.createRoomButton.disabled = !online.ready || online.busy;
    els.joinRoomButton.disabled = !online.ready || online.busy;
    if (!hasRoom) return;

    const room = online.room;
    const names = {
      p1: room.players.p1?.name || "Red",
      p2: room.players.p2?.name || "Waiting...",
    };
    const bothPlayers = Boolean(room.players.p1 && room.players.p2);
    els.roomCodeText.textContent = online.roomId;
    els.lobbyRedName.textContent = names.p1 + (online.seat === "p1" ? " (you)" : "");
    els.lobbyBlueName.textContent = names.p2 + (online.seat === "p2" ? " (you)" : "");
    els.lobbyBlueState.textContent = bothPlayers ? "Ready" : "Open seat";
    els.lobbyBlueState.closest(".seat-row")?.classList.toggle("is-open", !bothPlayers);
    els.waitingTitle.textContent = bothPlayers ? "Starting match" : "Waiting for Blue";
    els.waitingMessage.textContent = bothPlayers
      ? "Both players are ready. The board is opening now."
      : `${room.objective === OBJECTIVE_MAKE ? "Make shape" : "Avoid shape"} mode. Send the room code or invite link to your friend.`;
  }

  async function mutateOnline(action, extra = {}) {
    if (!online.roomId || !online.token || !online.authorized || online.busy) return;
    online.busy = true;
    render();
    try {
      if (online.seat === "p1") {
        const next = applyOnlineActionToState(online.room, "p1", action, extra);
        await commitHostState(next);
      } else {
        await broadcastOnline("room-action", {
          token: online.token,
          action,
          extra,
          rev: online.rev,
        });
        clearTimeout(online.actionTimer);
        online.actionTimer = setTimeout(() => {
          online.actionTimer = null;
          if (!online.busy) return;
          online.busy = false;
          showToast("The host did not receive that action. Try again.");
          pollOnlineRoom();
          render();
        }, ROOM_JOIN_TIMEOUT_MS);
      }
    } catch (error) {
      online.busy = false;
      showToast(error.message || "The room could not be updated.");
      await pollOnlineRoom();
      render();
    }
  }

  function playOnlineMove(index) {
    if (!online.authorized || state.phase !== "playing" || online.seat !== state.current || state.board[index]) return;
    mutateOnline("move", { index });
  }

  function inviteLink(roomId) {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("room", roomId);
    url.hash = "";
    return url.toString();
  }

  function updateRoomUrl(roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    history.replaceState({}, "", url);
  }

  function clearRoomUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    history.replaceState({}, "", url);
  }

  async function copyInviteLink() {
    if (!online.roomId) return;
    try {
      await navigator.clipboard.writeText(inviteLink(online.roomId));
      showToast("Invite link copied.");
    } catch {
      showToast(`Room code: ${online.roomId}`);
    }
  }

  async function shareInvite() {
    if (!online.roomId) return;
    const data = {
      title: "Color Trap",
      text: `Join my Color Trap room ${online.roomId}`,
      url: inviteLink(online.roomId),
    };
    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
    await copyInviteLink();
  }

  function leaveOnlineRoom(clearAccess = true) {
    if (online.seat === "p1" && online.subscription && online.connection === "live") {
      broadcastOnline("room-closed").catch(() => {});
    }
    disconnectOnlineTransport();
    if (clearAccess && online.roomId) clearRoomAccess(online.roomId);
    clearTimeout(online.actionTimer);
    online.actionTimer = null;
    online.authorized = false;
    online.busy = false;
    online.connection = "offline";
    online.guestToken = "";
    online.pendingGuestToken = "";
    online.rev = 0;
    online.room = null;
    online.roomId = "";
    online.seat = null;
    online.token = "";
    clearRoomUrl();
  }

  async function bootFromRoomLink() {
    const roomId = cleanRoomId(new URLSearchParams(location.search).get("room"));
    if (!roomId) return false;
    els.roomCodeInput.value = roomId;
    await openOnlineView();
    if (!online.ready) return true;
    const stored = getStoredRoom(roomId);
    if (stored?.token) {
      if (stored.name) els.onlineNameInput.value = stored.name;
      await joinOnlineRoom(roomId);
    } else {
      setOnlineMessage("Invite ready. Enter your name and tap Join.");
    }
    return true;
  }

  function syncSettingsControls() {
    els.soundToggle.checked = preferences.sound;
    els.hintsToggle.checked = preferences.hints;
  }

  els.playAiButton.addEventListener("click", startAiFlow);
  els.playLocalButton.addEventListener("click", () => startLocalMatch("local"));
  els.playOnlineButton.addEventListener("click", openOnlineView);
  els.objectiveAvoidButton.addEventListener("click", () => selectObjective(OBJECTIVE_AVOID));
  els.objectiveMakeButton.addEventListener("click", () => selectObjective(OBJECTIVE_MAKE));
  els.resumeButton.addEventListener("click", resumeMatch);
  els.brandHomeButton.addEventListener("click", goHome);
  els.exitGameButton.addEventListener("click", goHome);
  els.onlineBackButton.addEventListener("click", () => {
    leaveOnlineRoom(false);
    goHome();
  });
  els.leaveRoomButton.addEventListener("click", () => {
    leaveOnlineRoom(true);
    goHome();
  });
  els.createRoomButton.addEventListener("click", createOnlineRoom);
  els.joinRoomButton.addEventListener("click", () => joinOnlineRoom(els.roomCodeInput.value));
  els.roomCodeInput.addEventListener("input", () => {
    els.roomCodeInput.value = cleanRoomId(els.roomCodeInput.value);
  });
  els.roomCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinOnlineRoom(els.roomCodeInput.value);
  });
  els.copyInviteButton.addEventListener("click", copyInviteLink);
  els.shareInviteButton.addEventListener("click", shareInvite);
  els.newMatchButton.addEventListener("click", requestNewMatch);
  els.resultPrimaryButton.addEventListener("click", () => {
    if (state.phase === "matchover") rematch();
    else startNextRound();
  });
  els.resultHomeButton.addEventListener("click", goHome);

  els.rulesButton.addEventListener("click", () => openDialog(els.rulesDialog));
  els.closeRulesButton.addEventListener("click", () => closeDialog(els.rulesDialog));
  els.settingsButton.addEventListener("click", () => {
    syncSettingsControls();
    openDialog(els.settingsDialog);
  });
  els.closeSettingsButton.addEventListener("click", () => closeDialog(els.settingsDialog));
  els.soundToggle.addEventListener("change", () => {
    preferences.sound = els.soundToggle.checked;
    savePreferences();
    if (preferences.sound) playFeedback("move");
  });
  els.hintsToggle.addEventListener("change", () => {
    preferences.hints = els.hintsToggle.checked;
    savePreferences();
    render();
  });

  els.closeTutorialButton.addEventListener("click", () => closeDialog(els.tutorialDialog));
  els.tutorialPlayButton.addEventListener("click", () => {
    preferences.tutorialSeen = true;
    savePreferences();
    closeDialog(els.tutorialDialog);
    startLocalMatch("ai", { difficulty: "practice", practice: true });
  });
  els.confirmCancelButton.addEventListener("click", () => {
    confirmAction = null;
    closeDialog(els.confirmDialog);
  });
  els.confirmAcceptButton.addEventListener("click", () => {
    const action = confirmAction;
    confirmAction = null;
    if (action) action();
  });

  [els.rulesDialog, els.settingsDialog, els.tutorialDialog, els.confirmDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) ensureOnlineConnection();
  });
  window.addEventListener("focus", ensureOnlineConnection);
  window.addEventListener("online", ensureOnlineConnection);
  window.addEventListener("pageshow", ensureOnlineConnection);

  window.ColorTrapRules = {
    applyMoveToState,
    chooseAiMove,
    completesTrap,
    safeMoves,
    trapById,
    trapPlacements,
    wouldComplete,
    wouldLose,
  };
  renderTrapGallery();
  syncSettingsControls();
  render();
  bootFromRoomLink().then((handled) => {
    if (!handled) showView("home");
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
