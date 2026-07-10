const assert = require("node:assert/strict");
const {
  BOARD_SIZE,
  MATCH_TARGET,
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
  safeMoves,
  shouldShowOnlineLobby,
  shuffleTrapDeck,
  trapById,
  trapOrientations,
  trapPlacements,
  wouldLose,
} = require("../src/game.js");

assert.equal(BOARD_SIZE, 6);
assert.equal(MATCH_TARGET, 3);
assert.equal(TRAPS.length, 7);
assert.ok(TRAPS.every((trap) => trap.cells.length <= 4), "market deck should avoid draw-heavy five-piece traps");
assert.equal(coordForIndex(indexFor(3, 4)), "D5");
assert.equal(indexForCoord("D5"), indexFor(3, 4));
assert.equal(indexForCoord("Z9"), -1);

assert.equal(shouldShowOnlineLobby("ai", "playing", false), false);
assert.equal(shouldShowOnlineLobby("online", "lobby", false), true);
assert.equal(shouldShowOnlineLobby("online", "lobby", true), true);
assert.equal(shouldShowOnlineLobby("online", "playing", true), false);

{
  const room = createRoundState({
    mode: "online",
    phase: "playing",
    players: { p1: { name: "Host" }, p2: { name: "Guest" } },
  });
  assert.throws(() => applyOnlineActionToState(room, "p2", "move", { index: 0 }), /not your turn/);
  const moved = applyOnlineActionToState(room, "p1", "move", { index: 0 });
  assert.equal(moved.board[0], "p1");
  assert.equal(moved.current, "p2");
}

{
  const matchOver = createRoundState({
    mode: "online",
    phase: "matchover",
    scores: { p1: 3, p2: 1 },
    players: { p1: { name: "Host" }, p2: { name: "Guest" } },
  });
  const hostReady = applyOnlineActionToState(matchOver, "p1", "rematch");
  assert.equal(hostReady.rematchVotes.p1, true);
  const restarted = applyOnlineActionToState(hostReady, "p2", "rematch");
  assert.equal(restarted.phase, "playing");
  assert.deepEqual(restarted.scores, { p1: 0, p2: 0 });
}

const deterministicDeck = shuffleTrapDeck(() => 0.5);
assert.equal(deterministicDeck.length, TRAPS.length);
assert.equal(new Set(deterministicDeck).size, TRAPS.length, "a deck must contain every trap exactly once");
const noRepeatDeck = shuffleTrapDeck(() => 0.999, "line4");
assert.notEqual(noRepeatDeck[0], "line4", "a reshuffle must not immediately repeat the last trap");

const triangle = trapById("triangle");
assert.equal(trapOrientations(triangle).length, 4, "triangle should have four rotations");

const line = trapById("line4");
assert.equal(trapOrientations(line).length, 4, "line should include horizontal, vertical, and both diagonals");

const square = trapById("square");
assert.equal(trapOrientations(square).length, 1, "square is symmetric");

for (const trap of TRAPS) {
  const placements = trapPlacements(trap);
  assert.ok(placements.length > 0, `${trap.id} should have legal placements`);
  assert.ok(placements.every((placement) => placement.length === trap.cells.length));
  const board = emptyBoard();
  placements[0].forEach((index) => { board[index] = "p1"; });
  assert.equal(completesTrap(board, "p1", trap, placements[0][0]), true, `${trap.id} should be detected`);
}

{
  const board = emptyBoard();
  board[indexFor(0, 0)] = "p1";
  board[indexFor(2, 0)] = "p1";
  board[indexFor(1, 2)] = "p1";
  assert.equal(completesTrap(board, "p1", triangle, indexFor(1, 2)), true);
  assert.equal(completesTrap(board, "p2", triangle, indexFor(1, 2)), false);
}

{
  const board = emptyBoard();
  board[indexFor(0, 0)] = "p1";
  board[indexFor(2, 0)] = "p1";
  assert.equal(wouldLose(board, "p1", "triangle", indexFor(1, 2)), true);
  assert.equal(wouldLose(board, "p1", "triangle", indexFor(3, 3)), false);
}

for (const diagonal of [
  [[0, 0], [1, 1], [2, 2], [3, 3]],
  [[3, 0], [2, 1], [1, 2], [0, 3]],
]) {
  const board = emptyBoard();
  diagonal.forEach(([x, y]) => { board[indexFor(x, y)] = "p2"; });
  const [lastX, lastY] = diagonal[diagonal.length - 1];
  assert.equal(completesTrap(board, "p2", line, indexFor(lastX, lastY)), true);
}

{
  const state = createRoundState({ trapId: "line4", current: "p2", starter: "p2" });
  state.board[indexFor(0, 0)] = "p2";
  state.board[indexFor(1, 1)] = "p2";
  state.board[indexFor(2, 2)] = "p2";
  const next = applyMoveToState(state, indexFor(3, 3));
  assert.equal(next.phase, "roundover");
  assert.equal(next.winner, "p1");
  assert.equal(next.loser, "p2");
  assert.equal(next.scores.p1, 1);
}

{
  const state = createRoundState({ trapId: "square" });
  const moves = [
    indexFor(0, 0), indexFor(3, 3),
    indexFor(1, 0), indexFor(4, 3),
    indexFor(0, 1), indexFor(5, 3),
  ];
  let next = state;
  for (const move of moves) next = applyMoveToState(next, move);
  assert.equal(next.phase, "playing");
  assert.equal(next.current, "p1");
  next = applyMoveToState(next, indexFor(1, 1));
  assert.equal(next.phase, "roundover");
  assert.equal(next.winner, "p2");
  assert.equal(next.scores.p2, 1);
}

{
  const deck = TRAPS.map((trap) => trap.id);
  const first = createRoundState({ trapDeck: deck, trapCursor: 0, trapId: deck[0], starter: "p1" });
  const second = nextRoundState(first);
  const third = nextRoundState(second);
  assert.equal(second.current, "p2", "the second player should start round two");
  assert.equal(second.starter, "p2");
  assert.equal(second.trapId, deck[1], "the deck should advance without replacement");
  assert.equal(third.current, "p1", "the starting player should alternate every round");
  assert.equal(third.trapId, deck[2]);
}

{
  const board = emptyBoard();
  board[indexFor(0, 0)] = "p2";
  board[indexFor(2, 0)] = "p2";
  const move = chooseAiMove(board, "triangle", "p2");
  assert.notEqual(move, indexFor(1, 2), "standard AI should avoid completing its own triangle");
}

{
  const board = emptyBoard();
  board[indexFor(0, 0)] = "p1";
  board[indexFor(2, 0)] = "p1";
  const moves = safeMoves(board, "p1", "triangle");
  assert.equal(moves.includes(indexFor(1, 2)), false);
  assert.ok(moves.length > 0);
}

console.log("Color Trap rule tests passed.");
