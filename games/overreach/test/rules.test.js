const assert = require("node:assert/strict");
const { chooseAiCard, resolveRound, tierFor } = require("../src/game.js");

assert.equal(tierFor(1), "low");
assert.equal(tierFor(5), "mid");
assert.equal(tierFor(9), "high");

assert.deepEqual(
  pick(resolveRound(9, 5)),
  {
    winner: "p1",
    overreach: false,
    p1Points: 9,
    p2Points: 0,
    gap: 4,
  },
  "9 should beat 5 because the gap is exactly 4"
);

assert.deepEqual(
  pick(resolveRound(9, 4)),
  {
    winner: "p2",
    overreach: true,
    p1Points: 0,
    p2Points: 4,
    gap: 5,
  },
  "9 should overreach against 4"
);

assert.deepEqual(
  pick(resolveRound(6, 1)),
  {
    winner: "p2",
    overreach: true,
    p1Points: 0,
    p2Points: 1,
    gap: 5,
  },
  "6 should overreach against 1"
);

assert.deepEqual(
  pick(resolveRound(5, 1)),
  {
    winner: "p1",
    overreach: false,
    p1Points: 5,
    p2Points: 0,
    gap: 4,
  },
  "5 should beat 1 because the gap is exactly 4"
);

assert.deepEqual(
  pick(resolveRound(3, 3)),
  {
    winner: null,
    overreach: false,
    p1Points: 0,
    p2Points: 0,
    gap: 0,
  },
  "same number should tie"
);

for (let i = 0; i < 50; i += 1) {
  const card = chooseAiCard([1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(card >= 1 && card <= 9, "AI should choose a card from its hand");
}

for (let p1Card = 1; p1Card <= 9; p1Card += 1) {
  for (let p2Card = 1; p2Card <= 9; p2Card += 1) {
    const result = resolveRound(p1Card, p2Card);
    const reverse = resolveRound(p2Card, p1Card);

    assert.equal(result.p1Points, reverse.p2Points, "round resolution should be symmetric");
    assert.equal(result.p2Points, reverse.p1Points, "reverse resolution should preserve points");
    assert.equal(result.overreach, Math.abs(p1Card - p2Card) > 4, "only gaps over four should overreach");

    if (p1Card === p2Card) {
      assert.equal(result.winner, null, "matching cards should tie");
      assert.equal(result.p1Points + result.p2Points, 0, "ties should not score");
    } else {
      const winningCard = result.winner === "p1" ? p1Card : p2Card;
      assert.equal(result.p1Points + result.p2Points, winningCard, "the winner should score their own card");
    }
  }
}

console.log("Overreach rule tests passed.");

function pick(result) {
  return {
    winner: result.winner,
    overreach: result.overreach,
    p1Points: result.p1Points,
    p2Points: result.p2Points,
    gap: result.gap,
  };
}
