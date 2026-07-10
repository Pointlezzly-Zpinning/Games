const assert = require("node:assert/strict");
const roomHandler = require("../api/room.js");

const {
  cleanName,
  cleanRoomId,
  hashToken,
  seatForToken,
  tokenMatches,
} = roomHandler._internals;

assert.equal(cleanRoomId("ab-c12!3extra"), "ABC123");
assert.equal(cleanRoomId("O0I1"), "O0I1");
assert.equal(cleanName("  Ada\nLovelace  "), "AdaLovelace");
assert.equal(cleanName(""), "Player");

const p1Token = "host-seat-secret";
const p2Token = "guest-seat-secret";
const secret = {
  p1_token_hash: hashToken(p1Token),
  p2_token_hash: hashToken(p2Token),
};

assert.equal(tokenMatches(p1Token, secret.p1_token_hash), true);
assert.equal(tokenMatches("wrong", secret.p1_token_hash), false);
assert.equal(seatForToken(secret, p1Token), "p1");
assert.equal(seatForToken(secret, p2Token), "p2");
assert.equal(seatForToken(secret, "spectator"), null);

console.log("Color Trap API tests passed.");
