(function () {
  "use strict";

  const CARD_VALUES = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const MAX_ROUNDS = 9;
  const OVERREACH_GAP = 4;
  const TURN_SECONDS = 15;
  const REVEAL_MS = 2200;
  const POLL_MS = 650;
  const ROOM_ID_LENGTH = 6;
  const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function tierFor(card) {
    if (card <= 4) return "low";
    if (card <= 6) return "mid";
    return "high";
  }

  function resolveRound(p1Card, p2Card) {
    if (p1Card === p2Card) {
      return {
        winner: null,
        overreach: false,
        gap: 0,
        p1Points: 0,
        p2Points: 0,
        winningCard: null,
        higherPlayer: null,
        lowerPlayer: null,
      };
    }

    const higherPlayer = p1Card > p2Card ? "p1" : "p2";
    const lowerPlayer = higherPlayer === "p1" ? "p2" : "p1";
    const higherCard = Math.max(p1Card, p2Card);
    const lowerCard = Math.min(p1Card, p2Card);
    const gap = higherCard - lowerCard;
    const overreach = gap > OVERREACH_GAP;
    const winner = overreach ? lowerPlayer : higherPlayer;
    const winningCard = winner === "p1" ? p1Card : p2Card;

    return {
      winner,
      overreach,
      gap,
      p1Points: winner === "p1" ? winningCard : 0,
      p2Points: winner === "p2" ? winningCard : 0,
      winningCard,
      higherPlayer,
      lowerPlayer,
    };
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function scoreDifferentialForP2(p2Card, p1Card) {
    const result = resolveRound(p1Card, p2Card);
    return result.p2Points - result.p1Points;
  }

  function chooseAiCard(aiHand, playerHand) {
    if (aiHand.length === 1) return aiHand[0];
    if (Math.random() < 0.16) return randomItem(aiHand);

    const ranked = aiHand.map((card) => {
      const expected = playerHand.reduce((sum, playerCard) => {
        return sum + scoreDifferentialForP2(card, playerCard);
      }, 0) / playerHand.length;
      return { card, score: expected + Math.random() * 1.1 };
    });

    ranked.sort((a, b) => b.score - a.score);
    return ranked[0].card;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      CARD_VALUES,
      OVERREACH_GAP,
      chooseAiCard,
      resolveRound,
      tierFor,
    };
  }

  if (typeof document === "undefined") return;

  const els = Object.fromEntries([
    "activeHand",
    "aiSetup",
    "cancelLobbyButton",
    "closeHistoryButton",
    "closeRulesButton",
    "connectionChip",
    "copyInviteButton",
    "createRoomButton",
    "finalLeftScore",
    "finalRightScore",
    "gameOverHomeButton",
    "gameOverPanel",
    "gameOverText",
    "gameOverTitle",
    "gameView",
    "handEyebrow",
    "handPrompt",
    "historyButton",
    "historyCount",
    "historyFabCount",
    "historyList",
    "homeButton",
    "inviteBanner",
    "inviteRoomCode",
    "joinRoomButton",
    "leaveButton",
    "leftAvatar",
    "leftMiniHand",
    "leftPlayerName",
    "leftPlayerStatus",
    "leftRemainingLabel",
    "leftScore",
    "leftSlot",
    "leftWins",
    "lobbyOpponent",
    "lobbyOpponentName",
    "lobbyOpponentState",
    "lobbyStatusText",
    "lobbyView",
    "lobbyYouName",
    "localSetup",
    "lockCardButton",
    "modeAiButton",
    "modeLocalButton",
    "modeOnlineButton",
    "onlineSetup",
    "onlineStatusText",
    "p1NameInput",
    "p1NameLabel",
    "p2NameField",
    "p2NameInput",
    "privacyContinueButton",
    "privacyScreen",
    "privacyText",
    "privacyTitle",
    "rematchButton",
    "resultKicker",
    "resultText",
    "resultTitle",
    "rightAvatar",
    "rightMiniHand",
    "rightPlayerName",
    "rightPlayerStatus",
    "rightRemainingLabel",
    "rightScore",
    "rightSlot",
    "rightWins",
    "roomCodeInput",
    "roomCodeText",
    "roundDots",
    "roundText",
    "rulesButton",
    "rulesDialog",
    "setupForm",
    "setupView",
    "shareInviteButton",
    "timerToggle",
    "toast",
    "turnTimer",
    "turnTimerFill",
    "turnTimerLabel",
    "turnTimerValue",
  ].map((id) => [id, document.getElementById(id)]));
  els.matchSidebar = document.querySelector(".match-sidebar");

  const profile = {
    name: readStorage("overreachPlayerName") || "",
    localP1: readStorage("overreachLocalP1") || "Player 1",
    localP2: readStorage("overreachLocalP2") || "Player 2",
  };

  const online = {
    client: null,
    configError: "",
    initPromise: null,
    isReady: false,
    playerId: getOrCreatePlayerId(),
    pollTimer: null,
    refreshBusy: false,
    room: null,
    roomId: "",
    secret: "",
    failures: 0,
  };

  let appMode = "online";
  let timerEnabled = readStorage("overreachTimer") !== "off";
  let localState = createLocalState("ai");
  let selectedCard = null;
  let toastTimer = null;
  let actionBusy = false;
  let inviteCode = cleanRoomId(new URLSearchParams(window.location.search).get("room"));
  let clockTimer = null;

  function createLocalState(mode) {
    return {
      mode,
      phase: "setup",
      scores: { p1: 0, p2: 0 },
      roundWins: { p1: 0, p2: 0 },
      hands: { p1: [...CARD_VALUES], p2: [...CARD_VALUES] },
      pending: { p1: null, p2: null },
      history: [],
      last: null,
      turnStartedAt: null,
      revealUntil: null,
      timerEnabled,
    };
  }

  function localNames() {
    if (localState.mode === "ai") {
      return { p1: cleanName(profile.name, "You"), p2: "AI Rival" };
    }
    return {
      p1: cleanName(profile.localP1, "Player 1"),
      p2: cleanName(profile.localP2, "Player 2"),
    };
  }

  function cleanName(value, fallback = "Player") {
    return String(value || "").trim().slice(0, 18) || fallback;
  }

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // The game still works when storage is unavailable.
    }
  }

  function removeStorage(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage restrictions.
    }
  }

  function getOrCreatePlayerId() {
    const existing = readStorage("overreachPlayerId");
    if (existing) return existing;
    const id = crypto.randomUUID ? crypto.randomUUID() : randomSecret();
    writeStorage("overreachPlayerId", id);
    return id;
  }

  function credentialKey(roomId) {
    return `overreachRoomSecret:${roomId}`;
  }

  function randomSecret() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function cleanRoomId(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, ROOM_ID_LENGTH);
  }

  function generateRoomId() {
    const values = new Uint32Array(ROOM_ID_LENGTH);
    crypto.getRandomValues(values);
    return Array.from(values, (value) => ROOM_ID_ALPHABET[value % ROOM_ID_ALPHABET.length]).join("");
  }

  function setMode(mode) {
    if (appMode === mode) return;
    appMode = mode;
    selectedCard = null;
    renderSetup();
    if (mode === "online") prepareOnline();
  }

  function render() {
    const onlineActive = Boolean(online.room);
    const screen = onlineActive
      ? online.room.phase === "lobby" || online.room.phase === "countdown" ? "lobby" : "game"
      : localState.phase === "setup" ? "setup" : "game";

    els.setupView.classList.toggle("is-hidden", screen !== "setup");
    els.lobbyView.classList.toggle("is-hidden", screen !== "lobby");
    els.gameView.classList.toggle("is-hidden", screen !== "game");
    els.leaveButton.classList.toggle("is-hidden", screen === "setup");
    document.body.classList.toggle("has-game", screen === "game");

    if (screen === "setup") renderSetup();
    if (screen === "lobby") renderLobby();
    if (screen === "game") renderGame();
    renderConnection();
    renderPrivacy();
  }

  function renderSetup() {
    const onlineMode = appMode === "online";
    const aiMode = appMode === "ai";
    const localMode = appMode === "local";

    for (const [button, active] of [
      [els.modeOnlineButton, onlineMode],
      [els.modeAiButton, aiMode],
      [els.modeLocalButton, localMode],
    ]) {
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }

    els.onlineSetup.classList.toggle("is-hidden", !onlineMode);
    els.aiSetup.classList.toggle("is-hidden", !aiMode);
    els.localSetup.classList.toggle("is-hidden", !localMode);
    els.p2NameField.classList.toggle("is-hidden", !localMode);
    els.p1NameLabel.textContent = localMode ? "Player 1 name" : "Your name";
    els.timerToggle.checked = timerEnabled;

    if (document.activeElement !== els.p1NameInput) {
      els.p1NameInput.value = localMode ? profile.localP1 : profile.name;
      els.p1NameInput.placeholder = localMode ? "Player 1" : "Your name";
    }
    if (document.activeElement !== els.p2NameInput) els.p2NameInput.value = profile.localP2;

    els.inviteBanner.classList.toggle("is-hidden", !onlineMode || !inviteCode);
    els.inviteRoomCode.textContent = inviteCode || "------";
    if (inviteCode && document.activeElement !== els.roomCodeInput) {
      els.roomCodeInput.value = inviteCode;
    }

    els.createRoomButton.disabled = !online.isReady || actionBusy;
    els.joinRoomButton.disabled = !online.isReady || actionBusy;
    els.onlineStatusText.classList.toggle("is-error", Boolean(online.configError));
    els.onlineStatusText.textContent = online.configError
      ? online.configError
      : online.isReady
        ? "Online play is ready. Invite links work across phones and computers."
        : "Connecting to online play...";
  }

  function renderLobby() {
    const room = online.room;
    if (!room) return;
    const opponentJoined = Boolean(room.opponent?.joined);
    const countdown = countdownSeconds(room.startsAt);

    els.roomCodeText.textContent = online.roomId;
    els.lobbyYouName.textContent = room.you?.name || "You";
    els.lobbyOpponentName.textContent = opponentJoined ? room.opponent.name : "Waiting...";
    els.lobbyOpponent.classList.toggle("is-ready", opponentJoined);
    els.lobbyOpponentState.textContent = opponentJoined ? "Ready" : "Joining";

    if (room.phase === "countdown") {
      els.lobbyStatusText.textContent = countdown > 0
        ? `Match starts in ${countdown}`
        : "Starting match...";
    } else {
      els.lobbyStatusText.textContent = "Share the link. The match starts when your rival joins.";
    }
  }

  function countdownSeconds(value) {
    if (!value) return 0;
    return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000));
  }

  function getViewModel() {
    if (online.room) {
      const room = online.room;
      return {
        mode: "online",
        phase: room.phase,
        round: Number(room.round || 1),
        timerEnabled: Boolean(room.timerEnabled),
        roundStartedAt: room.roundStartedAt ? new Date(room.roundStartedAt).getTime() : null,
        left: room.opponent,
        right: room.you,
        leftLabel: room.opponent?.name || "Rival",
        rightLabel: room.you?.name || "You",
        rightMeta: "You",
        history: Array.isArray(room.history) ? room.history : [],
        last: room.lastRound || null,
        active: room.phase === "select" && !room.you?.locked,
        locked: Boolean(room.you?.locked),
        opponentLocked: Boolean(room.opponent?.locked),
        rematchYou: Boolean(room.rematch?.you),
        rematchOpponent: Boolean(room.rematch?.opponent),
      };
    }

    const names = localNames();
    const active = activeLocalPlayer();
    return {
      mode: localState.mode,
      phase: localState.phase,
      round: localState.phase === "reveal"
        ? localState.history.length
        : Math.min(localState.history.length + 1, MAX_ROUNDS),
      timerEnabled: localState.timerEnabled,
      roundStartedAt: localState.turnStartedAt,
      left: {
        name: names.p2,
        score: localState.scores.p2,
        wins: localState.roundWins.p2,
        hand: localState.hands.p2,
        locked: Boolean(localState.pending.p2),
        connected: true,
        joined: true,
      },
      right: {
        name: names.p1,
        score: localState.scores.p1,
        wins: localState.roundWins.p1,
        hand: localState.hands.p1,
        locked: Boolean(localState.pending.p1),
        connected: true,
        joined: true,
      },
      leftLabel: names.p2,
      rightLabel: names.p1,
      rightMeta: localState.mode === "ai" ? "You" : "Player 1",
      history: localState.history,
      last: localState.last,
      active: Boolean(active),
      activePlayer: active,
      locked: active === "p2" ? Boolean(localState.pending.p2) : Boolean(localState.pending.p1),
      opponentLocked: active === "p2" ? Boolean(localState.pending.p1) : false,
      rematchYou: false,
      rematchOpponent: false,
    };
  }

  function renderGame() {
    const vm = getViewModel();
    const completed = vm.history.length;

    els.leftPlayerName.textContent = vm.leftLabel;
    els.rightPlayerName.textContent = vm.rightLabel;
    els.leftPlayerStatus.textContent = online.room
      ? vm.left?.joined && !vm.left?.connected ? "Reconnecting" : "Rival"
      : localState.mode === "local" ? "Player 2" : "AI";
    els.rightPlayerStatus.textContent = online.room || localState.mode === "ai" ? "You" : "Player 1";
    els.leftScore.textContent = String(vm.left?.score || 0);
    els.rightScore.textContent = String(vm.right?.score || 0);
    els.leftWins.textContent = String(vm.left?.wins || 0);
    els.rightWins.textContent = String(vm.right?.wins || 0);
    els.leftAvatar.textContent = avatarLetter(vm.leftLabel);
    els.rightAvatar.textContent = avatarLetter(vm.rightLabel);

    els.roundText.textContent = vm.phase === "gameover" ? "Final" : `Round ${vm.round} of ${MAX_ROUNDS}`;
    els.roundDots.innerHTML = CARD_VALUES.map((round) => {
      const classes = ["round-dot"];
      if (round <= completed) classes.push("is-complete");
      if (round === vm.round && vm.phase !== "gameover") classes.push("is-current");
      return `<span class="${classes.join(" ")}"></span>`;
    }).join("");

    const leftHandCount = handCount(vm.left);
    const rightHandCount = handCount(vm.right);
    const localPlayerTwoView = vm.mode === "local" && vm.activePlayer === "p2";
    if (localPlayerTwoView) {
      renderMiniHand(els.leftMiniHand, vm.left?.hand || []);
      renderHiddenMiniHand(els.rightMiniHand, rightHandCount);
    } else {
      renderHiddenMiniHand(els.leftMiniHand, leftHandCount);
      renderMiniHand(els.rightMiniHand, vm.right?.hand || []);
    }
    els.leftRemainingLabel.textContent = `${vm.leftLabel} has ${leftHandCount} left`;
    els.rightRemainingLabel.textContent = `${vm.rightMeta === "You" ? "You have" : `${vm.rightLabel} has`} ${(vm.right?.hand || []).length} left`;

    renderSlots(vm);
    renderRoundMessage(vm);
    renderHand(vm);
    renderHistory(vm);
    renderTimer(vm);
    renderGameOver(vm);
  }

  function avatarLetter(name) {
    return String(name || "?").trim().charAt(0).toUpperCase() || "?";
  }

  function renderMiniHand(container, hand) {
    container.innerHTML = CARD_VALUES.map((card) => {
      const used = !hand.map(Number).includes(card);
      return `<span class="mini-token${used ? " is-used" : ""}">${used ? "" : card}</span>`;
    }).join("");
  }

  function renderHiddenMiniHand(container, count) {
    container.innerHTML = Array.from({ length: count }, () => {
      return '<span class="mini-token is-hidden-card" aria-hidden="true"></span>';
    }).join("");
  }

  function handCount(player) {
    const explicitCount = Number(player?.handCount);
    if (Number.isInteger(explicitCount) && explicitCount >= 0) return explicitCount;
    return Array.isArray(player?.hand) ? player.hand.length : 0;
  }

  function renderSlots(vm) {
    const revealing = vm.phase === "reveal" || vm.phase === "gameover";
    if (revealing && vm.last) {
      const cards = orientedCards(vm.last);
      els.leftSlot.innerHTML = playedCardMarkup(cards.left, didSideOverreach(vm.last, "left"));
      els.rightSlot.innerHTML = playedCardMarkup(cards.right, didSideOverreach(vm.last, "right"));
      els.leftSlot.className = "played-slot opponent-slot";
      els.rightSlot.className = "played-slot player-slot";
      return;
    }

    const leftLocked = online.room ? vm.opponentLocked : Boolean(localState.pending.p2);
    const rightLocked = online.room ? vm.locked : Boolean(localState.pending.p1);
    els.leftSlot.className = `played-slot opponent-slot${leftLocked ? " is-locked" : ""}`;
    els.rightSlot.className = `played-slot player-slot${rightLocked ? " is-locked" : ""}`;
    els.leftSlot.innerHTML = `<span>${leftLocked ? "Locked" : "Hidden"}</span>`;

    if (selectedCard && vm.active && (online.room || vm.activePlayer === "p1")) {
      els.rightSlot.innerHTML = playedCardMarkup(selectedCard, false);
    } else {
      els.rightSlot.innerHTML = `<span>${rightLocked ? "Locked" : "Yours"}</span>`;
    }
  }

  function playedCardMarkup(card, overreach) {
    return `<div class="played-card ${tierFor(Number(card))}${overreach ? " is-overreach" : ""}"><strong>${card}</strong><small>${tierFor(Number(card))}</small></div>`;
  }

  function orientedCards(entry) {
    const p1 = Number(entry.p1Card);
    const p2 = Number(entry.p2Card);
    if (online.room && online.room.seat === "p2") return { left: p1, right: p2 };
    return { left: p2, right: p1 };
  }

  function orientedWinner(entry) {
    const winner = entry?.result?.winner ?? entry?.winner ?? null;
    if (!winner) return null;
    if (online.room && online.room.seat === "p2") return winner === "p2" ? "right" : "left";
    return winner === "p1" ? "right" : "left";
  }

  function didSideOverreach(entry, side) {
    const overreach = Boolean(entry?.result?.overreach ?? entry?.overreach);
    if (!overreach) return false;
    const winner = orientedWinner(entry);
    return side !== winner;
  }

  function renderRoundMessage(vm) {
    if (vm.phase === "reveal" && vm.last) {
      const winner = orientedWinner(vm.last);
      const overreach = Boolean(vm.last?.result?.overreach ?? vm.last?.overreach);
      const cards = orientedCards(vm.last);
      els.resultKicker.textContent = overreach ? "Overreach" : winner ? "Round resolved" : "Tie";
      els.resultTitle.textContent = winner === "right"
        ? "You take the round"
        : winner === "left"
          ? `${vm.leftLabel} takes the round`
          : "No one scores";
      els.resultText.textContent = overreach
        ? `${Math.max(cards.left, cards.right)} reached too far. ${Math.min(cards.left, cards.right)} steals it.`
        : cards.left === cards.right
          ? `Both players spent ${cards.left}.`
          : `The winning token scores its own value.`;
      return;
    }

    if (vm.phase === "gameover") {
      els.resultKicker.textContent = "Match complete";
      els.resultTitle.textContent = "Nine rounds played";
      els.resultText.textContent = "Every token was spent exactly once.";
      return;
    }

    if (online.room && vm.phase === "select" && vm.locked) {
      els.resultKicker.textContent = vm.opponentLocked ? "Resolving" : "Locked";
      els.resultTitle.textContent = vm.opponentLocked ? "Both tokens are in" : `Waiting for ${vm.leftLabel}`;
      els.resultText.textContent = vm.opponentLocked
        ? "Revealing the round now."
        : "Your choice is hidden. You can leave this screen and reconnect safely.";
      return;
    }

    if (selectedCard && vm.active) {
      els.resultKicker.textContent = "Selected";
      els.resultTitle.textContent = `Token ${selectedCard} is ready`;
      els.resultText.textContent = selectedCard >= 7
        ? "Big score, narrow target. Lock it when the read feels right."
        : selectedCard <= 4
          ? "Low value, but it can punish a wild reach."
          : "Steady value against low tokens.";
      return;
    }

    const activeName = activeLocalPlayer() === "p2" ? vm.leftLabel : vm.rightMeta === "You" ? "You" : vm.rightLabel;
    els.resultKicker.textContent = "Your move";
    els.resultTitle.textContent = `${activeName} choose${activeName === "You" ? "" : "s"} a token`;
    els.resultText.textContent = "Read what is left, select a token, then lock it in.";
  }

  function renderHand(vm) {
    const activePlayer = online.room ? "you" : vm.activePlayer;
    const hand = online.room
      ? (vm.right?.hand || [])
      : activePlayer ? localState.hands[activePlayer] : localState.hands.p1;
    const canPick = Boolean(vm.active);
    const owner = online.room
      ? "Your hand"
      : localState.mode === "local" && activePlayer === "p2"
        ? `${vm.leftLabel}'s hand`
        : localState.mode === "local"
          ? `${vm.rightLabel}'s hand`
          : "Your hand";

    els.handEyebrow.textContent = owner;
    els.handPrompt.textContent = canPick
      ? selectedCard ? `Token ${selectedCard} selected` : "Select a token"
      : vm.phase === "reveal" ? "Next round starts automatically" : "Choice locked";
    els.lockCardButton.classList.toggle("is-hidden", !canPick || !selectedCard);
    els.lockCardButton.textContent = selectedCard ? `Lock ${selectedCard}` : "Lock token";
    els.lockCardButton.disabled = actionBusy;

    const numericHand = hand.map(Number);
    els.activeHand.innerHTML = CARD_VALUES.map((card) => {
      const available = numericHand.includes(card);
      const classes = ["token-card", tierFor(card)];
      if (!available) classes.push("is-used");
      if (selectedCard === card) classes.push("is-selected");
      const disabled = !canPick || !available || actionBusy;
      return `<button class="${classes.join(" ")}" type="button" data-card="${card}" ${disabled ? "disabled" : ""} aria-label="Select token ${card}"><span class="token-number">${available ? card : ""}</span><span class="token-family">${available ? tierFor(card) : "spent"}</span></button>`;
    }).join("");
  }

  function renderHistory(vm) {
    els.historyCount.textContent = `${vm.history.length} / ${MAX_ROUNDS} rounds`;
    els.historyFabCount.textContent = String(vm.history.length);
    if (!vm.history.length) {
      els.historyList.innerHTML = '<li class="history-empty">Your spent tokens appear here. Your rival\'s choices are yours to remember.</li>';
      return;
    }

    els.historyList.innerHTML = vm.history.map((entry) => {
      const viewer = historyViewerSeat(vm);
      const card = historyCardForViewer(entry, viewer);
      const winner = entry?.result?.winner ?? entry?.winner ?? null;
      const overreach = Boolean(entry?.result?.overreach ?? entry?.overreach);
      const opponentName = historyOpponentName(vm, viewer);
      const summary = overreach
        ? winner === viewer
          ? "You punished an overreach."
          : "Your token overreached."
        : winner === viewer
          ? "You won the round."
          : winner
            ? `${opponentName} won the round.`
            : "Tie. No points.";
      return `<li class="history-item"><span class="history-round">R${entry.round}</span><span class="history-token ${tierFor(card)}">${card}</span><span class="history-summary">${escapeHtml(summary)}</span></li>`;
    }).join("");
  }

  function historyViewerSeat(vm) {
    if (online.room) return online.room.seat;
    if (localState.mode === "ai") return "p1";
    return vm.activePlayer === "p2" || localState.phase === "pass-to-p2" ? "p2" : "p1";
  }

  function historyCardForViewer(entry, viewer) {
    const sanitizedCard = Number(entry?.yourCard);
    if (CARD_VALUES.includes(sanitizedCard)) return sanitizedCard;
    return Number(viewer === "p2" ? entry?.p2Card : entry?.p1Card);
  }

  function historyOpponentName(vm, viewer) {
    if (vm.mode === "local" && viewer === "p2") return vm.rightLabel;
    return vm.leftLabel;
  }

  function renderTimer(vm) {
    const active = vm.active && vm.timerEnabled && vm.roundStartedAt;
    els.turnTimer.classList.toggle("is-hidden", !active);
    if (!active) return;
    const remainingMs = vm.roundStartedAt + TURN_SECONDS * 1000 - Date.now();
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const ratio = Math.max(0, Math.min(1, remainingMs / (TURN_SECONDS * 1000)));
    els.turnTimerLabel.textContent = "Time to lock";
    els.turnTimerValue.textContent = String(seconds);
    els.turnTimerFill.style.transform = `scaleX(${ratio})`;
    els.turnTimer.classList.toggle("is-urgent", seconds <= 5);
  }

  function renderGameOver(vm) {
    const gameover = vm.phase === "gameover";
    els.gameOverPanel.classList.toggle("is-hidden", !gameover);
    if (!gameover) return;

    const rightScore = Number(vm.right?.score || 0);
    const leftScore = Number(vm.left?.score || 0);
    const rightWins = Number(vm.right?.wins || 0);
    const leftWins = Number(vm.left?.wins || 0);
    const rightWon = rightScore > leftScore || (rightScore === leftScore && rightWins > leftWins);
    const leftWon = leftScore > rightScore || (leftScore === rightScore && leftWins > rightWins);
    const youLabel = vm.mode === "local" ? vm.rightLabel : "You";

    els.gameOverTitle.textContent = rightWon ? `${youLabel} win${youLabel === "You" ? "" : "s"}` : leftWon ? `${vm.leftLabel} wins` : "Dead even";
    els.gameOverText.textContent = rightScore === leftScore && rightWins !== leftWins
      ? `The ${rightScore}-${leftScore} score tie was decided by rounds won.`
      : "All nine tokens are gone. The read is complete.";
    els.finalLeftScore.textContent = String(leftScore);
    els.finalRightScore.textContent = String(rightScore);

    if (online.room) {
      els.rematchButton.textContent = vm.rematchYou
        ? vm.rematchOpponent ? "Starting rematch..." : `Waiting for ${vm.leftLabel}`
        : vm.rematchOpponent ? `${vm.leftLabel} wants a rematch` : "Rematch";
      els.rematchButton.disabled = vm.rematchYou || actionBusy;
    } else {
      els.rematchButton.textContent = "Play again";
      els.rematchButton.disabled = false;
    }
  }

  function renderConnection() {
    const reconnecting = Boolean(online.room && online.failures > 0);
    els.connectionChip.classList.toggle("is-hidden", !reconnecting);
    els.connectionChip.textContent = online.failures >= 3 ? "Connection lost" : "Reconnecting";
  }

  function renderPrivacy() {
    const phase = localState.phase;
    const visible = !online.room && localState.mode === "local" && (phase === "pass-to-p1" || phase === "pass-to-p2");
    els.privacyScreen.classList.toggle("is-hidden", !visible);
    if (!visible) return;
    const names = localNames();
    const next = phase === "pass-to-p2" ? names.p2 : names.p1;
    els.privacyTitle.textContent = `Pass to ${next}`;
    els.privacyText.textContent = `${next}, tap ready when the previous choice is hidden.`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function activeLocalPlayer() {
    if (localState.mode === "ai" && localState.phase === "select") return "p1";
    if (localState.mode === "local" && localState.phase === "p1-select") return "p1";
    if (localState.mode === "local" && localState.phase === "p2-select") return "p2";
    return null;
  }

  function selectCard(card) {
    const vm = getViewModel();
    if (!vm.active || actionBusy) return;
    const hand = online.room ? vm.right.hand : localState.hands[vm.activePlayer];
    if (!hand.map(Number).includes(card)) return;
    selectedCard = card;
    renderGame();
  }

  async function lockSelectedCard() {
    if (!selectedCard || actionBusy) return;
    const card = selectedCard;
    actionBusy = true;
    render();
    try {
      if (online.room) {
        const room = await callRoomRpc("overreach_play_card_v2", { p_card: card });
        applyOnlineRoom(room);
      } else {
        playLocalCard(card);
      }
      selectedCard = null;
    } catch (error) {
      handleOnlineError(error, "That token could not be locked. Try again.");
    } finally {
      actionBusy = false;
      render();
    }
  }

  function playLocalCard(card) {
    const active = activeLocalPlayer();
    if (!active || !localState.hands[active].includes(card)) return;

    if (localState.mode === "ai") {
      const aiCard = chooseAiCard(localState.hands.p2, localState.hands.p1);
      resolveLocalRound(card, aiCard);
      return;
    }

    if (active === "p1") {
      localState.pending.p1 = card;
      localState.phase = "pass-to-p2";
      localState.turnStartedAt = null;
      selectedCard = null;
      render();
      return;
    }

    localState.pending.p2 = card;
    resolveLocalRound(localState.pending.p1, card);
  }

  function resolveLocalRound(p1Card, p2Card) {
    const result = resolveRound(p1Card, p2Card);
    const entry = {
      round: localState.history.length + 1,
      p1Card,
      p2Card,
      result,
    };

    localState.scores.p1 += result.p1Points;
    localState.scores.p2 += result.p2Points;
    if (result.winner) localState.roundWins[result.winner] += 1;
    localState.hands.p1 = localState.hands.p1.filter((value) => value !== p1Card);
    localState.hands.p2 = localState.hands.p2.filter((value) => value !== p2Card);
    localState.pending = { p1: null, p2: null };
    localState.history.unshift(entry);
    localState.last = entry;
    localState.turnStartedAt = null;
    localState.phase = localState.history.length >= MAX_ROUNDS ? "gameover" : "reveal";
    localState.revealUntil = Date.now() + REVEAL_MS;
    selectedCard = null;
    render();
  }

  function startLocalGame(mode) {
    saveNamesFromForm();
    localState = createLocalState(mode);
    localState.phase = mode === "ai" ? "select" : "p1-select";
    localState.turnStartedAt = Date.now();
    selectedCard = null;
    render();
  }

  function continuePrivacy() {
    if (localState.phase === "pass-to-p2") localState.phase = "p2-select";
    else if (localState.phase === "pass-to-p1") localState.phase = "p1-select";
    else return;
    localState.turnStartedAt = Date.now();
    render();
  }

  function tick() {
    if (online.room?.phase === "countdown") renderLobby();
    if (!els.gameView.classList.contains("is-hidden")) {
      const vm = getViewModel();
      renderTimer(vm);
      if (!online.room) tickLocalState(vm);
    }
  }

  function tickLocalState(vm) {
    if (localState.phase === "reveal" && Date.now() >= localState.revealUntil) {
      localState.phase = localState.mode === "ai" ? "select" : "pass-to-p1";
      localState.turnStartedAt = localState.mode === "ai" ? Date.now() : null;
      localState.revealUntil = null;
      render();
      return;
    }

    if (!vm.active || !vm.timerEnabled || !vm.roundStartedAt || actionBusy) return;
    if (Date.now() < vm.roundStartedAt + TURN_SECONDS * 1000) return;
    const player = vm.activePlayer;
    const card = randomItem(localState.hands[player]);
    showToast(`Time expired. Token ${card} was selected.`);
    selectedCard = card;
    lockSelectedCard();
  }

  function saveNamesFromForm() {
    timerEnabled = Boolean(els.timerToggle.checked);
    writeStorage("overreachTimer", timerEnabled ? "on" : "off");
    if (appMode === "local") {
      profile.localP1 = cleanName(els.p1NameInput.value, "Player 1");
      profile.localP2 = cleanName(els.p2NameInput.value, "Player 2");
      writeStorage("overreachLocalP1", profile.localP1);
      writeStorage("overreachLocalP2", profile.localP2);
    } else {
      profile.name = cleanName(els.p1NameInput.value, "Player");
      writeStorage("overreachPlayerName", profile.name);
    }
  }

  async function prepareOnline() {
    if (online.client) return online.client;
    if (online.initPromise) return online.initPromise;

    online.initPromise = (async () => {
      try {
        const response = await fetch("/api/supabase-config", { cache: "no-store" });
        if (!response.ok) throw new Error("Online play is temporarily unavailable.");
        const payload = await response.json();
        const config = payload.config || payload;
        if (!config.url || !config.anonKey || !window.supabase) {
          throw new Error("Online play is not configured yet.");
        }
        online.client = window.supabase.createClient(config.url, config.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        online.isReady = true;
        online.configError = "";
        render();
        return online.client;
      } catch (error) {
        online.isReady = false;
        online.configError = error.message || "Online play is temporarily unavailable.";
        render();
        return null;
      }
    })();

    return online.initPromise;
  }

  async function createOnlineRoom() {
    if (actionBusy) return;
    saveNamesFromForm();
    const client = await prepareOnline();
    if (!client) return;

    actionBusy = true;
    render();
    try {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const roomId = generateRoomId();
        const secret = randomSecret();
        const { data, error } = await client.rpc("overreach_create_room_v2", {
          p_room_id: roomId,
          p_player_id: online.playerId,
          p_player_name: profile.name,
          p_player_secret: secret,
          p_timer_enabled: timerEnabled,
        });
        if (error && isRoomCodeCollision(error)) continue;
        if (error) throw error;
        online.roomId = roomId;
        online.secret = secret;
        writeStorage(credentialKey(roomId), secret);
        updateRoomUrl(roomId);
        applyOnlineRoom(data);
        startPolling();
        showToast("Private match created.");
        return;
      }
      throw new Error("Could not create a room code. Try again.");
    } catch (error) {
      handleOnlineError(error, "Could not create a private match.");
    } finally {
      actionBusy = false;
      render();
    }
  }

  async function joinOnlineRoom(roomIdValue, options = {}) {
    if (actionBusy) return;
    const roomId = cleanRoomId(roomIdValue);
    if (roomId.length !== ROOM_ID_LENGTH) {
      showToast("Enter the six-character room code.");
      return;
    }

    saveNamesFromForm();
    const client = await prepareOnline();
    if (!client) return;
    const storedSecret = readStorage(credentialKey(roomId));
    const secret = storedSecret || randomSecret();

    actionBusy = true;
    render();
    try {
      const { data, error } = await client.rpc("overreach_join_room_v2", {
        p_room_id: roomId,
        p_player_id: online.playerId,
        p_player_name: profile.name,
        p_player_secret: secret,
      });
      if (error) throw error;
      online.roomId = roomId;
      online.secret = secret;
      writeStorage(credentialKey(roomId), secret);
      updateRoomUrl(roomId);
      applyOnlineRoom(data);
      startPolling();
      if (!options.silent) showToast(storedSecret ? "Match restored." : "Joined private match.");
    } catch (error) {
      if (!storedSecret) removeStorage(credentialKey(roomId));
      if (options.silent) {
        inviteCode = roomId;
        clearOnlineSession(false);
      } else {
        handleOnlineError(error, "Could not join that room.");
      }
    } finally {
      actionBusy = false;
      render();
    }
  }

  function isRoomCodeCollision(error) {
    return String(error?.code || "").includes("23505") || String(error?.message || "").includes("room_code_taken");
  }

  async function callRoomRpc(functionName, extra = {}) {
    const client = await prepareOnline();
    if (!client || !online.roomId || !online.secret) throw new Error("Room connection is missing.");
    const { data, error } = await client.rpc(functionName, {
      p_room_id: online.roomId,
      p_player_secret: online.secret,
      ...extra,
    });
    if (error) throw error;
    return data;
  }

  function applyOnlineRoom(room) {
    if (!room) return;
    const previousPhase = online.room?.phase;
    const previousRound = online.room?.round;
    online.room = room;
    online.failures = 0;
    if (room.phase !== previousPhase || room.round !== previousRound || room.you?.locked) selectedCard = null;
    render();
  }

  function startPolling() {
    stopPolling();
    online.pollTimer = window.setInterval(refreshOnlineRoom, POLL_MS);
  }

  function stopPolling() {
    if (online.pollTimer) window.clearInterval(online.pollTimer);
    online.pollTimer = null;
  }

  async function refreshOnlineRoom() {
    if (online.refreshBusy || !online.roomId || !online.secret) return;
    online.refreshBusy = true;
    try {
      const room = await callRoomRpc("overreach_get_room_v2");
      applyOnlineRoom(room);
    } catch (error) {
      online.failures += 1;
      if (online.failures === 4) showToast("Connection lost. Reconnecting...");
      renderConnection();
      if (isTerminalRoomError(error)) {
        showToast("This room is no longer available.");
        clearOnlineSession();
        render();
      }
    } finally {
      online.refreshBusy = false;
    }
  }

  function isTerminalRoomError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("room_not_found") || message.includes("invalid_room_secret");
  }

  function handleOnlineError(error, fallback) {
    const message = String(error?.message || "").toLowerCase();
    let friendly = fallback;
    if (message.includes("room_not_found")) friendly = "That room code does not exist or has expired.";
    if (message.includes("room_full")) friendly = "That room already has two players.";
    if (message.includes("invalid_room_secret")) friendly = "This device cannot reclaim that player seat.";
    if (message.includes("overreach_create_room_v2") || message.includes("schema cache")) {
      friendly = "Online play is being upgraded. Try again in a moment.";
    }
    showToast(friendly);
  }

  async function leaveOnlineRoom() {
    if (!online.room) return;
    const roomId = online.roomId;
    try {
      await callRoomRpc("overreach_leave_room_v2");
    } catch {
      // Local cleanup should never be blocked by a lost connection.
    }
    removeStorage(credentialKey(roomId));
    clearOnlineSession();
    showToast("You left the match.");
    render();
  }

  function clearOnlineSession(clearUrl = true) {
    stopPolling();
    online.room = null;
    online.roomId = "";
    online.secret = "";
    online.failures = 0;
    selectedCard = null;
    if (clearUrl) updateRoomUrl("");
  }

  async function requestRematch() {
    if (actionBusy) return;
    if (!online.room) {
      startLocalGame(localState.mode);
      return;
    }
    actionBusy = true;
    render();
    try {
      const room = await callRoomRpc("overreach_rematch_v2");
      applyOnlineRoom(room);
    } catch (error) {
      handleOnlineError(error, "Could not request a rematch.");
    } finally {
      actionBusy = false;
      render();
    }
  }

  function updateRoomUrl(roomId) {
    const url = new URL(window.location.href);
    if (roomId) url.searchParams.set("room", roomId);
    else url.searchParams.delete("room");
    window.history.replaceState({}, "", url);
  }

  function inviteLink() {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("room", online.roomId);
    return url.toString();
  }

  async function copyInvite() {
    if (!online.roomId) return;
    try {
      await navigator.clipboard.writeText(inviteLink());
      showToast("Invite link copied.");
    } catch {
      showToast(`Room code: ${online.roomId}`);
    }
  }

  async function shareInvite() {
    if (!online.roomId) return;
    const shareData = {
      title: "Play Overreach with me",
      text: `Join my Overreach match. Room ${online.roomId}.`,
      url: inviteLink(),
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    copyInvite();
  }

  function backToModes() {
    if (online.room) {
      leaveOnlineRoom();
      return;
    }
    localState = createLocalState(appMode === "online" ? "ai" : appMode);
    selectedCard = null;
    render();
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  function openRules() {
    if (typeof els.rulesDialog.showModal === "function") els.rulesDialog.showModal();
  }

  function closeRules() {
    if (els.rulesDialog.open) els.rulesDialog.close();
  }

  function openHistory() {
    els.matchSidebar.classList.add("is-open");
  }

  function closeHistory() {
    els.matchSidebar.classList.remove("is-open");
  }

  function handleSetupSubmit(event) {
    event.preventDefault();
    if (appMode === "ai") startLocalGame("ai");
    if (appMode === "local") startLocalGame("local");
  }

  function handleNameInput() {
    if (appMode === "local") {
      profile.localP1 = els.p1NameInput.value.slice(0, 18);
      profile.localP2 = els.p2NameInput.value.slice(0, 18);
    } else {
      profile.name = els.p1NameInput.value.slice(0, 18);
    }
  }

  function bootFromInvite() {
    if (!inviteCode) return;
    appMode = "online";
    els.roomCodeInput.value = inviteCode;
    const secret = readStorage(credentialKey(inviteCode));
    if (secret) {
      prepareOnline().then(() => joinOnlineRoom(inviteCode, { silent: true }));
    }
  }

  els.modeOnlineButton.addEventListener("click", () => setMode("online"));
  els.modeAiButton.addEventListener("click", () => setMode("ai"));
  els.modeLocalButton.addEventListener("click", () => setMode("local"));
  els.setupForm.addEventListener("submit", handleSetupSubmit);
  els.p1NameInput.addEventListener("input", handleNameInput);
  els.p2NameInput.addEventListener("input", handleNameInput);
  els.timerToggle.addEventListener("change", () => {
    timerEnabled = els.timerToggle.checked;
    writeStorage("overreachTimer", timerEnabled ? "on" : "off");
  });
  els.roomCodeInput.addEventListener("input", () => {
    els.roomCodeInput.value = cleanRoomId(els.roomCodeInput.value);
  });
  els.roomCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      joinOnlineRoom(els.roomCodeInput.value);
    }
  });
  els.createRoomButton.addEventListener("click", createOnlineRoom);
  els.joinRoomButton.addEventListener("click", () => joinOnlineRoom(els.roomCodeInput.value));
  els.copyInviteButton.addEventListener("click", copyInvite);
  els.shareInviteButton.addEventListener("click", shareInvite);
  els.cancelLobbyButton.addEventListener("click", leaveOnlineRoom);
  els.leaveButton.addEventListener("click", backToModes);
  els.homeButton.addEventListener("click", () => {
    if (els.setupView.classList.contains("is-hidden")) showToast("Use the leave button to exit this match.");
  });
  els.activeHand.addEventListener("click", (event) => {
    const button = event.target.closest("[data-card]");
    if (button) selectCard(Number(button.dataset.card));
  });
  els.lockCardButton.addEventListener("click", lockSelectedCard);
  els.privacyContinueButton.addEventListener("click", continuePrivacy);
  els.rematchButton.addEventListener("click", requestRematch);
  els.gameOverHomeButton.addEventListener("click", backToModes);
  els.rulesButton.addEventListener("click", openRules);
  els.closeRulesButton.addEventListener("click", closeRules);
  els.rulesDialog.addEventListener("click", (event) => {
    if (event.target === els.rulesDialog) closeRules();
  });
  els.historyButton.addEventListener("click", openHistory);
  els.closeHistoryButton.addEventListener("click", closeHistory);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && online.room) refreshOnlineRoom();
  });
  window.addEventListener("online", () => online.room && refreshOnlineRoom());

  window.OverreachRules = { chooseAiCard, resolveRound, tierFor };

  els.p1NameInput.value = profile.name;
  els.p2NameInput.value = profile.localP2;
  clockTimer = window.setInterval(tick, 250);
  prepareOnline();
  bootFromInvite();
  render();
})();
