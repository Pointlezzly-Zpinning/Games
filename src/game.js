(function () {
  "use strict";

  const CARD_VALUES = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const MAX_ROUNDS = 9;
  const OVERREACH_GAP = 4;
  const TURN_SECONDS = 15;
  const ROOM_TABLE = "overreach_rooms";
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

    if (Math.random() < 0.16) {
      return randomItem(aiHand);
    }

    const ranked = aiHand.map((card) => {
      const expected = playerHand.reduce((sum, playerCard) => {
        return sum + scoreDifferentialForP2(card, playerCard);
      }, 0) / playerHand.length;
      const uncertainty = Math.random() * 1.1;
      return { card, score: expected + uncertainty };
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

  const els = {
    activeHand: document.getElementById("activeHand"),
    closeRulesButton: document.getElementById("closeRulesButton"),
    copyInviteButton: document.getElementById("copyInviteButton"),
    createRoomButton: document.getElementById("createRoomButton"),
    handOwnerLabel: document.getElementById("handOwnerLabel"),
    historyCount: document.getElementById("historyCount"),
    historyList: document.getElementById("historyList"),
    joinRoomButton: document.getElementById("joinRoomButton"),
    modeAiButton: document.getElementById("modeAiButton"),
    modeLocalButton: document.getElementById("modeLocalButton"),
    modeOnlineButton: document.getElementById("modeOnlineButton"),
    nextRoundButton: document.getElementById("nextRoundButton"),
    onlineHelpText: document.getElementById("onlineHelpText"),
    onlinePanel: document.getElementById("onlinePanel"),
    onlineStatusText: document.getElementById("onlineStatusText"),
    p1MiniHand: document.getElementById("p1MiniHand"),
    p1NameInput: document.getElementById("p1NameInput"),
    p1NameScore: document.getElementById("p1NameScore"),
    p1RailLabel: document.getElementById("p1RailLabel"),
    p1RemainingText: document.getElementById("p1RemainingText"),
    p1Score: document.getElementById("p1Score"),
    p1Slot: document.getElementById("p1Slot"),
    p1Wins: document.getElementById("p1Wins"),
    p2MiniHand: document.getElementById("p2MiniHand"),
    p2NameInput: document.getElementById("p2NameInput"),
    p2NameScore: document.getElementById("p2NameScore"),
    p2RailLabel: document.getElementById("p2RailLabel"),
    p2RemainingText: document.getElementById("p2RemainingText"),
    p2Score: document.getElementById("p2Score"),
    p2Slot: document.getElementById("p2Slot"),
    p2Wins: document.getElementById("p2Wins"),
    phasePill: document.getElementById("phasePill"),
    privacyContinueButton: document.getElementById("privacyContinueButton"),
    privacyScreen: document.getElementById("privacyScreen"),
    privacyText: document.getElementById("privacyText"),
    privacyTitle: document.getElementById("privacyTitle"),
    resetButton: document.getElementById("resetButton"),
    resultKicker: document.getElementById("resultKicker"),
    resultText: document.getElementById("resultText"),
    roomCodeInput: document.getElementById("roomCodeInput"),
    roomCodePill: document.getElementById("roomCodePill"),
    roomCodeText: document.getElementById("roomCodeText"),
    roundDots: document.getElementById("roundDots"),
    roundText: document.getElementById("roundText"),
    rulesButton: document.getElementById("rulesButton"),
    rulesDialog: document.getElementById("rulesDialog"),
    startGameButton: document.getElementById("startGameButton"),
    timerToggle: document.getElementById("timerToggle"),
    toast: document.getElementById("toast"),
    turnTimer: document.getElementById("turnTimer"),
    turnTimerFill: document.getElementById("turnTimerFill"),
    turnTimerLabel: document.getElementById("turnTimerLabel"),
    turnTimerValue: document.getElementById("turnTimerValue"),
    turnPrompt: document.getElementById("turnPrompt"),
  };

  let state = createState("ai");
  let toastTimer = null;
  let turnTimerId = null;
  let turnTimerKey = null;
  let turnTimerDeadline = 0;
  let timerEnabled = true;
  const online = {
    client: null,
    configError: "",
    initPromise: null,
    isConfigured: false,
    isReady: false,
    isSaving: false,
    playerId: getOrCreatePlayerId(),
    room: null,
    roomId: "",
    rev: 0,
    seat: null,
    subscription: null,
  };
  const defaultNames = {
    ai: { p1: "You", p2: "AI Rival" },
    local: { p1: "Player 1", p2: "Player 2" },
    online: { p1: "Player 1", p2: "Player 2" },
  };
  const namesByMode = {
    ai: { ...defaultNames.ai },
    local: { ...defaultNames.local },
    online: { ...defaultNames.online },
  };

  function createState(mode) {
    return {
      mode,
      phase: "setup",
      scores: { p1: 0, p2: 0 },
      roundWins: { p1: 0, p2: 0 },
      hands: {
        p1: [...CARD_VALUES],
        p2: [...CARD_VALUES],
      },
      pending: { p1: null, p2: null },
      history: [],
      last: null,
    };
  }

  function playerNames() {
    const defaults = defaultNames[state.mode];
    const names = namesByMode[state.mode];
    return {
      p1: displayName(names.p1, defaults.p1),
      p2: displayName(names.p2, defaults.p2),
    };
  }

  function displayName(value, fallback) {
    const cleaned = value.trim();
    return cleaned || fallback;
  }

  function isYou(name) {
    return name.trim().toLowerCase() === "you";
  }

  function possessive(name) {
    return isYou(name) ? "Your" : `${name}'s`;
  }

  function winPhrase(name) {
    return `${name} ${isYou(name) ? "win" : "wins"}`;
  }

  function scorePhrase(name) {
    return `${name} ${isYou(name) ? "score" : "scores"}`;
  }

  function updateName(player, value) {
    namesByMode[state.mode][player] = value.slice(0, 18);
    if (state.mode === "online" && online.room && online.seat === player) {
      saveOnlineRoom((room) => {
        const players = normalizePlayers(room.players);
        players[player] = {
          ...(players[player] || {}),
          id: online.playerId,
          name: displayName(value, defaultNames.online[player]),
        };
        return {
          ...room,
          players,
          updatedAt: Date.now(),
        };
      });
    }
    render();
  }

  function currentRoundNumber() {
    return Math.min(state.history.length + 1, MAX_ROUNDS);
  }

  function setMode(mode) {
    if (state.mode === mode) return;
    stopTurnTimer();
    state = createState(mode);
    if (mode === "online") {
      showToast("Online rooms selected.");
      prepareOnlineMode();
    } else {
      leaveOnlineRoom(false);
      showToast(mode === "ai" ? "AI duel started." : "Pass-and-play started.");
    }
    render();
  }

  function startNewGame() {
    const mode = state.mode;
    stopTurnTimer();
    if (mode === "online" && online.room) {
      resetOnlineRoom();
      return;
    }
    state = createState(mode);
    showToast("New game ready.");
    render();
  }

  function startGame() {
    if (state.mode === "online") {
      startOnlineGame();
      return;
    }
    if (state.phase !== "setup") return;
    state.phase = state.mode === "ai" ? "select" : "p1-select";
    showToast(timerEnabled
      ? "Game started. 15 seconds per pick."
      : "Game started. Timer off.");
    render();
  }

  function removeCard(hand, card) {
    return hand.filter((value) => value !== card);
  }

  function handleCardPick(card) {
    if (state.phase === "gameover" || state.phase === "between-rounds") return;
    if (!activePlayer()) return;

    stopTurnTimer();

    if (state.mode === "online") {
      playOnlineCard(card);
      return;
    }

    if (state.mode === "ai") {
      const aiCard = chooseAiCard(state.hands.p2, state.hands.p1);
      playRound(card, aiCard);
      return;
    }

    if (state.phase === "p1-select") {
      state.pending.p1 = card;
      state.phase = "pass-to-p2";
      render();
      return;
    }

    if (state.phase === "p2-select") {
      state.pending.p2 = card;
      playRound(state.pending.p1, state.pending.p2);
    }
  }

  function playRound(p1Card, p2Card) {
    const names = playerNames();
    const result = resolveRound(p1Card, p2Card);
    const round = state.history.length + 1;
    const entry = {
      round,
      p1Card,
      p2Card,
      result,
      summary: summarizeRound(result, p1Card, p2Card, names),
    };

    state.scores.p1 += result.p1Points;
    state.scores.p2 += result.p2Points;
    if (result.winner) state.roundWins[result.winner] += 1;

    state.hands.p1 = removeCard(state.hands.p1, p1Card);
    state.hands.p2 = removeCard(state.hands.p2, p2Card);
    state.pending = { p1: null, p2: null };
    state.last = entry;
    state.history.unshift(entry);
    state.phase = state.history.length >= MAX_ROUNDS
      ? "gameover"
      : state.mode === "local"
        ? "between-rounds"
        : "select";

    render();
  }

  function summarizeRound(result, p1Card, p2Card, names) {
    if (!result.winner) return "Same number. Nobody scores.";

    const winnerName = names[result.winner];
    const higherName = names[result.higherPlayer];
    const higherCard = result.higherPlayer === "p1" ? p1Card : p2Card;

    if (result.overreach) {
      return `${possessive(higherName)} ${higherCard} overreached by ${result.gap}. ${scorePhrase(winnerName)} ${result.winningCard}.`;
    }

    return `${possessive(winnerName)} ${result.winningCard} wins for ${result.winningCard}.`;
  }

  function advanceLocalRound() {
    if (state.mode === "online") {
      advanceOnlineRound();
      return;
    }
    state.phase = "pass-to-p1";
    render();
  }

  function continuePrivacy() {
    if (state.phase === "pass-to-p2") {
      state.phase = "p2-select";
    } else if (state.phase === "pass-to-p1") {
      state.phase = "p1-select";
    }
    render();
  }

  function turnKey() {
    const active = activePlayer();
    if (!active) return null;
    return [
      state.mode,
      online.roomId || "local",
      state.phase,
      state.history.length,
      state.pending.p1 ?? "none",
      onlineChoice(active)?.commit ?? "open",
      state.hands[active].join("-"),
    ].join(":");
  }

  function manageTurnTimer() {
    const active = activePlayer();
    const key = turnKey();

    if (!timerEnabled) {
      stopTurnTimer();
      renderTurnTimer(null);
      return;
    }

    if (!active || !key) {
      stopTurnTimer();
      renderTurnTimer(null);
      return;
    }

    if (turnTimerKey !== key) {
      startTurnTimer(key, activeTurnDeadline());
    }

    updateTurnTimer();
  }

  function startTurnTimer(key, deadline = Date.now() + TURN_SECONDS * 1000) {
    stopTurnTimer();
    turnTimerKey = key;
    turnTimerDeadline = deadline;
    turnTimerId = setInterval(updateTurnTimer, 250);
  }

  function stopTurnTimer() {
    if (turnTimerId) {
      clearInterval(turnTimerId);
      turnTimerId = null;
    }
    turnTimerKey = null;
    turnTimerDeadline = 0;
  }

  function updateTurnTimer() {
    if (!timerEnabled) {
      stopTurnTimer();
      renderTurnTimer(null);
      return;
    }

    const active = activePlayer();
    const key = turnKey();

    if (!active || key !== turnTimerKey) {
      manageTurnTimer();
      return;
    }

    const remainingMs = turnTimerDeadline - Date.now();
    const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
    renderTurnTimer(active, secondsLeft);

    if (remainingMs <= 0) {
      stopTurnTimer();
      autoPlayTimedOutTurn(active);
    }
  }

  function activeTurnDeadline() {
    if (state.mode === "online" && online.room?.timerEnabled && online.room.turnStartedAt) {
      return online.room.turnStartedAt + TURN_SECONDS * 1000;
    }
    return Date.now() + TURN_SECONDS * 1000;
  }

  function renderTurnTimer(active, secondsLeft = TURN_SECONDS) {
    if (!active || !timerEnabled) {
      els.turnTimer.classList.add("is-hidden");
      return;
    }

    const names = playerNames();
    const name = names[active];
    const ratio = Math.max(0, Math.min(1, secondsLeft / TURN_SECONDS));
    els.turnTimer.classList.remove("is-hidden");
    els.turnTimer.classList.toggle("is-urgent", secondsLeft <= 5);
    els.turnTimerLabel.textContent = isYou(name)
      ? "You have 15 seconds"
      : `${name} has 15 seconds`;
    els.turnTimerValue.textContent = String(secondsLeft);
    els.turnTimerFill.style.transform = `scaleX(${ratio})`;
  }

  function autoPlayTimedOutTurn(active) {
    if (!timerEnabled) return;
    if (active !== activePlayer()) return;

    const hand = state.hands[active];
    if (!hand.length) return;

    const card = randomItem(hand);
    const name = playerNames()[active];
    showToast(isYou(name)
      ? `Time ran out. You played ${card}.`
      : `${name} ran out of time and played ${card}.`);
    handleCardPick(card);
  }

  function finalMessage() {
    const names = playerNames();
    if (state.scores.p1 > state.scores.p2) {
      return `${winPhrase(names.p1)} by score, ${state.scores.p1}-${state.scores.p2}.`;
    }
    if (state.scores.p2 > state.scores.p1) {
      return `${winPhrase(names.p2)} by score, ${state.scores.p2}-${state.scores.p1}.`;
    }
    if (state.roundWins.p1 > state.roundWins.p2) {
      return `${winPhrase(names.p1)} the score tie on rounds, ${state.roundWins.p1}-${state.roundWins.p2}.`;
    }
    if (state.roundWins.p2 > state.roundWins.p1) {
      return `${winPhrase(names.p2)} the score tie on rounds, ${state.roundWins.p2}-${state.roundWins.p1}.`;
    }
    return "Dead even after score and round wins.";
  }

  function render() {
    const names = playerNames();
    const round = currentRoundNumber();

    renderModeButtons();
    renderOnlinePanel();
    renderTimerToggle();
    renderNames(names);
    renderNameInputs();
    renderScoreboard(round);
    renderSlots();
    renderMiniHands();
    renderActiveHand();
    renderHistory();
    renderPrompt(names);
    renderPrivacy(names);
    manageTurnTimer();
  }

  function renderModeButtons() {
    const aiActive = state.mode === "ai";
    const localActive = state.mode === "local";
    const onlineActive = state.mode === "online";
    els.modeAiButton.classList.toggle("is-active", aiActive);
    els.modeLocalButton.classList.toggle("is-active", localActive);
    els.modeOnlineButton.classList.toggle("is-active", onlineActive);
    els.modeAiButton.setAttribute("aria-pressed", String(aiActive));
    els.modeLocalButton.setAttribute("aria-pressed", String(localActive));
    els.modeOnlineButton.setAttribute("aria-pressed", String(onlineActive));
  }

  function renderTimerToggle() {
    els.timerToggle.checked = state.mode === "online" && online.room
      ? Boolean(online.room.timerEnabled)
      : timerEnabled;
  }

  function renderOnlinePanel() {
    const isOnline = state.mode === "online";
    els.onlinePanel.classList.toggle("is-hidden", !isOnline);
    if (!isOnline) return;

    const room = online.room;
    const hasRoom = Boolean(room && online.roomId);
    const canUseOnline = online.isReady;
    const bothPlayers = Boolean(room?.players?.p1?.id && room?.players?.p2?.id);
    const inviteUrl = hasRoom ? inviteLink(online.roomId) : "";

    els.createRoomButton.disabled = !canUseOnline;
    els.joinRoomButton.disabled = !canUseOnline;
    els.copyInviteButton.classList.toggle("is-hidden", !hasRoom);
    els.roomCodePill.classList.toggle("is-hidden", !hasRoom);
    els.roomCodeText.textContent = online.roomId || "------";

    if (!online.isConfigured) {
      els.onlineStatusText.textContent = "Supabase is not connected yet.";
      els.onlineHelpText.textContent = online.configError || "Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel, then redeploy.";
      return;
    }

    if (!hasRoom) {
      els.onlineStatusText.textContent = "Create a room, then send the invite link.";
      els.onlineHelpText.textContent = "Your friend joins as Player 2 on their phone. Both picks lock before reveal.";
      return;
    }

    if (!bothPlayers) {
      els.onlineStatusText.textContent = `Room ${online.roomId} is waiting for Player 2.`;
      els.onlineHelpText.textContent = `Send ${inviteUrl}`;
      return;
    }

    els.onlineStatusText.textContent = online.seat
      ? `You are ${online.seat === "p1" ? "Player 1" : "Player 2"} in room ${online.roomId}.`
      : `Watching room ${online.roomId}.`;
    els.onlineHelpText.textContent = room.phase === "lobby"
      ? "Both players are in. Start when ready."
      : "Each phone only controls its own hand.";
  }

  function renderNames(names) {
    els.p1NameScore.textContent = names.p1;
    els.p2NameScore.textContent = names.p2;
    els.p1RailLabel.textContent = names.p1;
    els.p2RailLabel.textContent = names.p2;
  }

  function renderNameInputs() {
    const names = namesByMode[state.mode];
    if (document.activeElement !== els.p1NameInput) {
      els.p1NameInput.value = names.p1;
    }
    if (document.activeElement !== els.p2NameInput) {
      els.p2NameInput.value = names.p2;
    }
    const onlineRoomActive = state.mode === "online" && Boolean(online.room);
    els.p1NameInput.disabled = onlineRoomActive && online.seat !== "p1";
    els.p2NameInput.disabled = onlineRoomActive && online.seat !== "p2";
  }

  function renderScoreboard(round) {
    els.p1Score.textContent = String(state.scores.p1);
    els.p2Score.textContent = String(state.scores.p2);
    els.p1Wins.textContent = String(state.roundWins.p1);
    els.p2Wins.textContent = String(state.roundWins.p2);
    els.roundText.textContent = state.phase === "gameover" ? "Final" : `Round ${round} of ${MAX_ROUNDS}`;
    els.p1RemainingText.textContent = tokenCountText(state.hands.p1.length);
    els.p2RemainingText.textContent = tokenCountText(state.hands.p2.length);

    els.roundDots.innerHTML = CARD_VALUES.map((_, index) => {
      const dotRound = index + 1;
      const classes = ["round-dot"];
      if (dotRound <= state.history.length) classes.push("is-done");
      if (dotRound === round && state.phase !== "gameover") classes.push("is-current");
      return `<span class="${classes.join(" ")}"></span>`;
    }).join("");
  }

  function tokenCountText(count) {
    return `${count} token${count === 1 ? "" : "s"} left`;
  }

  function renderSlots() {
    if (state.mode === "online" && online.room?.phase === "select") {
      els.p1Slot.innerHTML = onlineSlotMarkup("p1");
      els.p2Slot.innerHTML = onlineSlotMarkup("p2");
      return;
    }

    if (state.last) {
      els.p1Slot.innerHTML = largeTokenMarkup(state.last.p1Card, "p1");
      els.p2Slot.innerHTML = largeTokenMarkup(state.last.p2Card, "p2");
      return;
    }

    els.p1Slot.innerHTML = '<div class="empty-slot">P1</div>';
    els.p2Slot.innerHTML = '<div class="card-back">Hidden</div>';
  }

  function onlineSlotMarkup(player) {
    const choice = onlineChoice(player);
    if (choice?.reveal?.card && bothOnlineRevealsReady()) {
      return largeTokenMarkup(Number(choice.reveal.card), player);
    }
    if (choice?.commit) {
      return '<div class="card-back">Locked</div>';
    }
    return player === online.seat
      ? `<div class="empty-slot">${player === "p1" ? "P1" : "P2"}</div>`
      : '<div class="card-back">Hidden</div>';
  }

  function renderMiniHands() {
    const showP1Numbers = state.mode !== "online" || online.seat === "p1";
    const showP2Numbers = state.mode === "ai" || (state.mode === "online" && online.seat === "p2");
    els.p1MiniHand.innerHTML = miniHandMarkup(state.hands.p1, showP1Numbers);
    els.p2MiniHand.innerHTML = miniHandMarkup(state.hands.p2, showP2Numbers);
  }

  function miniHandMarkup(hand, showNumbers) {
    return hand.map((card) => {
      const label = showNumbers ? card : "";
      const classes = ["mini-token"];
      if (!showNumbers) classes.push("is-back");
      return `<span class="${classes.join(" ")}">${label}</span>`;
    }).join("");
  }

  function activePlayer() {
    if (state.mode === "online") {
      if (online.room?.phase !== "select") return null;
      if (!online.seat) return null;
      return onlineChoice(online.seat)?.commit ? null : online.seat;
    }
    if (state.phase === "select") return "p1";
    if (state.phase === "p1-select") return "p1";
    if (state.phase === "p2-select") return "p2";
    return null;
  }

  function renderActiveHand() {
    const active = activePlayer();
    const hand = active ? state.hands[active] : [];
    els.activeHand.innerHTML = hand.length
      ? hand.map((card) => cardButtonMarkup(card)).join("")
      : disabledHandMarkup();

    els.activeHand.querySelectorAll("[data-card]").forEach((button) => {
      button.addEventListener("click", () => {
        handleCardPick(Number(button.dataset.card));
      });
    });
  }

  function disabledHandMarkup() {
    return CARD_VALUES.map((card) => {
      return cardButtonMarkup(card, true);
    }).join("");
  }

  function cardButtonMarkup(card, disabled = false) {
    const tier = tierFor(card);
    return `
      <button
        class="token-card tier-${tier}"
        type="button"
        data-card="${card}"
        aria-label="Play token ${card}"
        ${disabled ? "disabled" : ""}
      >
        <span class="token-number">
          ${card}
          <span class="token-family">${tier}</span>
        </span>
        ${pipGridMarkup(card)}
      </button>
    `;
  }

  function largeTokenMarkup(card, owner) {
    const tier = tierFor(card);
    return `
      <div class="large-token tier-${tier}" aria-label="${owner} played ${card}">
        <span class="token-number">${card}</span>
        ${pipGridMarkup(card)}
      </div>
    `;
  }

  function pipGridMarkup(card) {
    return `
      <span class="pip-grid" aria-hidden="true">
        ${CARD_VALUES.map((value) => {
          return `<span class="pip ${value <= card ? "is-on" : ""}"></span>`;
        }).join("")}
      </span>
    `;
  }

  function renderHistory() {
    els.historyCount.textContent = `${state.history.length} / ${MAX_ROUNDS}`;

    if (!state.history.length) {
      els.historyList.innerHTML = '<li class="history-empty">Played rounds will appear here.</li>';
      return;
    }

    els.historyList.innerHTML = state.history.map((entry) => {
      const result = entry.result;
      const badge = result.winner
        ? `${result.winner === "p1" ? "P1" : "P2"} +${result.winningCard}`
        : "Tie";
      const badgeClasses = ["outcome-badge"];
      badgeClasses.push(result.winner ? `is-${result.winner}` : "is-tie");
      if (result.overreach) badgeClasses.push("is-overreach");

      return `
        <li class="history-item">
          <div class="history-topline">
            <span class="rail-label">Round ${entry.round}</span>
            <span class="${badgeClasses.join(" ")}">${badge}</span>
          </div>
          <div class="history-cards">
            <span class="history-token">${entry.p1Card}</span>
            <span>vs</span>
            <span class="history-token">${entry.p2Card}</span>
          </div>
          <p>${entry.summary}</p>
        </li>
      `;
    }).join("");
  }

  function renderPrompt(names) {
    const onlineLobbyReady = state.mode === "online"
      && state.phase === "lobby"
      && Boolean(online.room?.players?.p1?.id && online.room?.players?.p2?.id);
    els.nextRoundButton.classList.toggle("is-hidden", state.phase !== "between-rounds");
    els.startGameButton.classList.toggle("is-hidden", state.phase !== "setup" && !onlineLobbyReady);

    if (state.phase === "setup") {
      els.handOwnerLabel.textContent = "Ready";
      els.turnPrompt.textContent = state.mode === "online" ? "Create or join a room" : "Enter names, then start";
      els.phasePill.textContent = timerEnabled ? "15 seconds per pick" : "Timer off";
      els.resultKicker.textContent = "Setup";
      els.resultText.textContent = state.mode === "online"
        ? "Online rooms let two phones pick at the same time."
        : "Start when both players are ready.";
      return;
    }

    if (state.mode === "online" && state.phase === "lobby") {
      const hasP2 = Boolean(online.room?.players?.p2?.id);
      els.handOwnerLabel.textContent = "Online room";
      els.turnPrompt.textContent = hasP2 ? "Both players joined" : "Waiting for Player 2";
      els.phasePill.textContent = online.room?.timerEnabled ? "15 seconds per pick" : "Timer off";
      els.resultKicker.textContent = hasP2 ? "Ready" : "Invite";
      els.resultText.textContent = hasP2
        ? "Start when both players are ready."
        : "Send the room link to your friend.";
      return;
    }

    if (state.phase === "gameover") {
      els.handOwnerLabel.textContent = "Game over";
      els.turnPrompt.textContent = finalMessage();
      els.phasePill.textContent = "New game resets the board";
      els.resultKicker.textContent = "Final";
      els.resultText.textContent = finalMessage();
      return;
    }

    if (state.phase === "between-rounds") {
      els.handOwnerLabel.textContent = "Round complete";
      els.turnPrompt.textContent = state.mode === "online"
        ? "Next round when both players are ready"
        : "Pass back for the next pick";
      els.phasePill.textContent = "Both tokens discarded";
      els.resultKicker.textContent = state.last?.result.overreach ? "Overreach" : "Resolved";
      els.resultText.textContent = state.last?.summary ?? "Round resolved.";
      return;
    }

    if (state.phase === "pass-to-p2" || state.phase === "pass-to-p1") {
      els.handOwnerLabel.textContent = "Hidden";
      els.turnPrompt.textContent = "Pass the device";
      els.phasePill.textContent = "Secret pick";
      return;
    }

    const active = activePlayer();
    if (state.mode === "online" && !active) {
      const other = online.seat === "p1" ? "p2" : "p1";
      els.handOwnerLabel.textContent = "Locked";
      els.turnPrompt.textContent = onlineChoice(online.seat)?.commit
        ? `Waiting for ${names[other]}`
        : "Waiting for your seat";
      els.phasePill.textContent = "Secret pick";
      els.resultKicker.textContent = "Locked";
      els.resultText.textContent = "Your token is locked. The round reveals after both players choose.";
      return;
    }

    els.handOwnerLabel.textContent = `${possessive(names[active])} hand`;
    els.turnPrompt.textContent = isYou(names[active])
      ? "Choose your token"
      : `${names[active]}, choose a token`;
    els.phasePill.textContent = active === "p1" && state.mode === "ai"
      ? "The AI picks at the same time"
      : "Keep the pick secret";

    if (state.last) {
      els.resultKicker.textContent = state.last.result.overreach ? "Overreach" : "Resolved";
      els.resultText.textContent = state.last.summary;
    } else {
      els.resultKicker.textContent = "Ready";
      els.resultText.textContent = "Pick a token from your hand.";
    }
  }

  function renderPrivacy(names) {
    const needsPrivacy = state.mode !== "online"
      && (state.phase === "pass-to-p2" || state.phase === "pass-to-p1");
    els.privacyScreen.classList.toggle("is-hidden", !needsPrivacy);
    if (!needsPrivacy) return;

    const target = state.phase === "pass-to-p2" ? "p2" : "p1";
    els.privacyTitle.textContent = `Pass to ${names[target]}`;
    els.privacyText.textContent = `${names[target]} chooses next. The previous pick is hidden.`;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => {
      els.toast.classList.remove("is-visible");
    }, 1800);
  }

  function setTimerEnabled(enabled) {
    if (state.mode === "online" && online.room) {
      saveOnlineRoom((room) => ({
        ...room,
        timerEnabled: enabled,
        updatedAt: Date.now(),
      }));
      showToast(enabled ? "Room timer on." : "Room timer off.");
      return;
    }

    timerEnabled = enabled;
    if (!timerEnabled) {
      stopTurnTimer();
      renderTurnTimer(null);
    }
    showToast(timerEnabled ? "Timer on." : "Timer off.");
    render();
  }

  function openRules() {
    if (typeof els.rulesDialog.showModal === "function") {
      els.rulesDialog.showModal();
    } else {
      els.rulesDialog.setAttribute("open", "");
    }
  }

  function closeRules() {
    if (typeof els.rulesDialog.close === "function") {
      els.rulesDialog.close();
    } else {
      els.rulesDialog.removeAttribute("open");
    }
  }

  function getOrCreatePlayerId() {
    const key = "overreachPlayerId";
    try {
      const existing = window.localStorage.getItem(key);
      if (existing) return existing;
      const id = crypto.randomUUID ? crypto.randomUUID() : randomSalt();
      window.localStorage.setItem(key, id);
      return id;
    } catch {
      return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
    }
  }

  async function prepareOnlineMode() {
    try {
      await ensureSupabaseClient();
      if (!online.room) {
        showToast("Supabase connected.");
      }
      render();
    } catch (error) {
      online.isReady = false;
      online.configError = error.message;
      showToast("Online rooms need Supabase setup.");
      render();
    }
  }

  async function ensureSupabaseClient() {
    if (online.client) return online.client;
    if (online.initPromise) return online.initPromise;

    online.initPromise = (async () => {
      if (!window.supabase?.createClient) {
        online.isConfigured = false;
        throw new Error("Supabase client did not load. Check the CDN script or network connection.");
      }

      const config = await loadSupabaseConfig();
      if (!config.url || !config.anonKey) {
        online.isConfigured = false;
        throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY.");
      }

      online.client = window.supabase.createClient(config.url, config.anonKey);
      online.isConfigured = true;
      online.isReady = true;
      online.configError = "";
      return online.client;
    })();

    return online.initPromise;
  }

  async function loadSupabaseConfig() {
    if (window.OVERREACH_SUPABASE_CONFIG) {
      return window.OVERREACH_SUPABASE_CONFIG;
    }

    const response = await fetch("/api/supabase-config", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Could not read Supabase config from Vercel.");
    }

    const payload = await response.json();
    if (!payload.configured) {
      return {};
    }

    return payload.config;
  }

  async function createOnlineRoom() {
    try {
      const client = await ensureSupabaseClient();
      const name = displayName(namesByMode.online.p1, defaultNames.online.p1);

      for (let attempt = 0; attempt < 4; attempt += 1) {
        const roomId = generateRoomId();
        const room = createOnlineRoomState({
          p1: { id: online.playerId, name },
          p2: null,
        });

        const { data, error } = await client
          .from(ROOM_TABLE)
          .insert({ id: roomId, state: room, rev: 0 })
          .select("id, state, rev")
          .single();

        if (!error && data) {
          online.roomId = roomId;
          online.seat = "p1";
          updateRoomUrl(roomId);
          await connectOnlineRoom(roomId, data);
          showToast(`Room ${roomId} created.`);
          return;
        }

        if (!isDuplicateRoomError(error)) {
          throw error;
        }
      }

      throw new Error("Could not create a unique room code.");
    } catch (error) {
      console.error(error);
      showToast("Could not create room. Check Supabase setup.");
      render();
    }
  }

  async function joinOnlineRoom(rawRoomId) {
    const roomId = cleanRoomId(rawRoomId);
    if (!roomId) {
      showToast("Enter a room code.");
      return;
    }

    try {
      await ensureSupabaseClient();
      const row = await fetchOnlineRoom(roomId);
      if (!row) {
        showToast("Room not found.");
        return;
      }

      const room = normalizeOnlineRoom(row.state);
      const existingSeat = seatForPlayer(room);
      const openSeat = existingSeat || (!room.players.p1?.id ? "p1" : !room.players.p2?.id ? "p2" : null);

      if (!openSeat) {
        showToast("That room is full.");
        return;
      }

      online.roomId = roomId;
      online.room = room;
      online.rev = row.rev;
      online.seat = openSeat;

      if (!existingSeat) {
        await saveOnlineRoom((current) => {
          const players = normalizePlayers(current.players);
          players[openSeat] = {
            id: online.playerId,
            name: displayName(namesByMode.online[openSeat], defaultNames.online[openSeat]),
          };
          return {
            ...current,
            players,
            updatedAt: Date.now(),
          };
        });
      }

      updateRoomUrl(roomId);
      await connectOnlineRoom(roomId);
      showToast(`Joined room ${roomId}.`);
    } catch (error) {
      console.error(error);
      showToast("Could not join room. Check Supabase setup.");
      render();
    }
  }

  async function connectOnlineRoom(roomId, initialRow = null) {
    const client = await ensureSupabaseClient();
    leaveOnlineRoom(false);
    online.roomId = roomId;

    if (initialRow) {
      applyOnlineRow(initialRow);
    } else {
      const row = await fetchOnlineRoom(roomId);
      if (row) applyOnlineRow(row);
    }

    online.subscription = client
      .channel(`overreach-room-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: ROOM_TABLE,
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.new) applyOnlineRow(payload.new);
        }
      )
      .subscribe();
  }

  function leaveOnlineRoom(clearRoom = true) {
    if (online.subscription && online.client) {
      online.client.removeChannel(online.subscription);
    }
    online.subscription = null;
    if (!clearRoom) return;
    online.room = null;
    online.roomId = "";
    online.rev = 0;
    online.seat = null;
  }

  function applyOnlineRow(row) {
    online.rev = Number(row.rev || 0);
    online.room = normalizeOnlineRoom(row.state);
    online.seat = seatForPlayer(online.room) || online.seat;
    syncStateFromOnlineRoom();
    render();
    revealOnlineChoiceIfReady().catch(console.error);
    resolveOnlineRoundIfReady().catch(console.error);
  }

  function syncStateFromOnlineRoom() {
    if (!online.room) return;

    const room = normalizeOnlineRoom(online.room);
    timerEnabled = Boolean(room.timerEnabled);
    namesByMode.online = {
      p1: room.players.p1?.name || defaultNames.online.p1,
      p2: room.players.p2?.name || defaultNames.online.p2,
    };

    state = {
      mode: "online",
      phase: room.phase || "lobby",
      scores: room.scores,
      roundWins: room.roundWins,
      hands: room.hands,
      pending: { p1: null, p2: null },
      history: room.history,
      last: room.last,
    };
  }

  async function fetchOnlineRoom(roomId) {
    const client = await ensureSupabaseClient();
    const { data, error } = await client
      .from(ROOM_TABLE)
      .select("id, state, rev")
      .eq("id", roomId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function saveOnlineRoom(mutator) {
    if (!online.roomId) return null;
    const client = await ensureSupabaseClient();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const currentRow = await fetchOnlineRoom(online.roomId);
      if (!currentRow) throw new Error("Room no longer exists.");

      const currentRoom = normalizeOnlineRoom(currentRow.state);
      const nextRoom = mutator(currentRoom);
      if (!nextRoom) return null;

      const nextRev = Number(currentRow.rev || 0) + 1;
      const { data, error } = await client
        .from(ROOM_TABLE)
        .update({
          state: normalizeOnlineRoom(nextRoom),
          rev: nextRev,
          updated_at: new Date().toISOString(),
        })
        .eq("id", online.roomId)
        .eq("rev", currentRow.rev)
        .select("id, state, rev")
        .maybeSingle();

      if (error) throw error;
      if (data) {
        applyOnlineRow(data);
        return data;
      }
    }

    throw new Error("Room update conflict. Try again.");
  }

  function createOnlineRoomState(players) {
    return {
      version: 1,
      phase: "lobby",
      timerEnabled,
      turnStartedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      players,
      scores: { p1: 0, p2: 0 },
      roundWins: { p1: 0, p2: 0 },
      hands: {
        p1: [...CARD_VALUES],
        p2: [...CARD_VALUES],
      },
      choices: {},
      history: [],
      last: null,
    };
  }

  function resetOnlineRoom() {
    if (!online.room) return;
    saveOnlineRoom((room) => {
      const fresh = createOnlineRoomState(normalizePlayers(room.players));
      return {
        ...fresh,
        phase: room.players.p1?.id && room.players.p2?.id ? "lobby" : "lobby",
        timerEnabled: room.timerEnabled,
        createdAt: room.createdAt || Date.now(),
      };
    });
    showToast("Online room reset.");
  }

  function startOnlineGame() {
    if (!online.room) return;
    saveOnlineRoom((room) => {
      if (room.phase !== "lobby") return null;
      if (!room.players.p1?.id || !room.players.p2?.id) return null;
      return {
        ...room,
        phase: "select",
        choices: {},
        last: null,
        turnStartedAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
  }

  function advanceOnlineRound() {
    if (!online.room) return;
    saveOnlineRoom((room) => {
      if (room.phase !== "between-rounds") return null;
      return {
        ...room,
        phase: "select",
        choices: {},
        last: null,
        turnStartedAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
  }

  async function playOnlineCard(card) {
    if (!online.room || !online.seat) return;
    if (online.room.phase !== "select") return;
    if (onlineChoice(online.seat)?.commit) return;
    if (!state.hands[online.seat].includes(card)) return;

    const round = state.history.length + 1;
    const salt = randomSalt();
    const commit = await hashOnlinePick(online.roomId, round, online.seat, card, salt);
    storeLocalReveal(round, online.seat, { card, salt, commit });

    await saveOnlineRoom((room) => {
      if (room.phase !== "select") return null;
      const choices = normalizeChoices(room.choices);
      if (choices[online.seat]?.commit) return null;
      choices[online.seat] = {
        commit,
        pickedAt: Date.now(),
        playerId: online.playerId,
      };
      return {
        ...room,
        choices,
        updatedAt: Date.now(),
      };
    });

    showToast(`Token ${card} locked.`);
  }

  async function revealOnlineChoiceIfReady() {
    if (!online.room || !online.seat) return;
    if (!bothOnlineCommitsReady()) return;

    const choice = onlineChoice(online.seat);
    if (!choice?.commit || choice.reveal) return;

    const reveal = readLocalReveal(state.history.length + 1, online.seat);
    if (!reveal || reveal.commit !== choice.commit) return;

    await saveOnlineRoom((room) => {
      if (!bothCommitsReady(room)) return null;
      const choices = normalizeChoices(room.choices);
      if (!choices[online.seat]?.commit || choices[online.seat].reveal) return null;
      choices[online.seat] = {
        ...choices[online.seat],
        reveal: {
          card: reveal.card,
          salt: reveal.salt,
        },
      };
      return {
        ...room,
        choices,
        updatedAt: Date.now(),
      };
    });
  }

  async function resolveOnlineRoundIfReady() {
    if (!online.room || online.room.phase !== "select") return;
    if (!bothOnlineRevealsReady()) return;

    await saveOnlineRoom((room) => {
      if (room.phase !== "select" || !bothRevealsReady(room)) return null;

      const p1Card = Number(room.choices.p1.reveal.card);
      const p2Card = Number(room.choices.p2.reveal.card);
      const result = resolveRound(p1Card, p2Card);
      const names = {
        p1: room.players.p1?.name || defaultNames.online.p1,
        p2: room.players.p2?.name || defaultNames.online.p2,
      };
      const entry = {
        round: room.history.length + 1,
        p1Card,
        p2Card,
        result,
        summary: summarizeRound(result, p1Card, p2Card, names),
      };
      const history = [entry, ...room.history];
      const scores = {
        p1: room.scores.p1 + result.p1Points,
        p2: room.scores.p2 + result.p2Points,
      };
      const roundWins = { ...room.roundWins };
      if (result.winner) roundWins[result.winner] += 1;

      return {
        ...room,
        phase: history.length >= MAX_ROUNDS ? "gameover" : "between-rounds",
        scores,
        roundWins,
        hands: {
          p1: removeCard(room.hands.p1, p1Card),
          p2: removeCard(room.hands.p2, p2Card),
        },
        choices: {},
        history,
        last: entry,
        turnStartedAt: null,
        updatedAt: Date.now(),
      };
    });
  }

  function normalizeOnlineRoom(room) {
    return {
      version: 1,
      phase: room?.phase || "lobby",
      timerEnabled: room?.timerEnabled !== false,
      turnStartedAt: room?.turnStartedAt || null,
      createdAt: room?.createdAt || Date.now(),
      updatedAt: room?.updatedAt || Date.now(),
      players: normalizePlayers(room?.players),
      scores: normalizeScorePair(room?.scores),
      roundWins: normalizeScorePair(room?.roundWins),
      hands: {
        p1: normalizeHand(room?.hands?.p1),
        p2: normalizeHand(room?.hands?.p2),
      },
      choices: normalizeChoices(room?.choices),
      history: normalizeHistory(room?.history),
      last: room?.last || null,
    };
  }

  function normalizePlayers(players = {}) {
    return {
      p1: players.p1 || null,
      p2: players.p2 || null,
    };
  }

  function normalizeScorePair(value = {}) {
    return {
      p1: Number(value.p1 || 0),
      p2: Number(value.p2 || 0),
    };
  }

  function normalizeHand(hand) {
    if (!Array.isArray(hand)) return [...CARD_VALUES];
    return hand.map(Number).filter((card) => CARD_VALUES.includes(card));
  }

  function normalizeChoices(choices = {}) {
    return {
      ...(choices || {}),
    };
  }

  function normalizeHistory(history) {
    if (Array.isArray(history)) return history;
    if (!history) return [];
    return Object.values(history);
  }

  function onlineChoice(player) {
    if (!player) return null;
    return online.room?.choices?.[player] || null;
  }

  function bothOnlineCommitsReady() {
    return bothCommitsReady(online.room);
  }

  function bothOnlineRevealsReady() {
    return bothRevealsReady(online.room);
  }

  function bothCommitsReady(room) {
    return Boolean(room?.choices?.p1?.commit && room?.choices?.p2?.commit);
  }

  function bothRevealsReady(room) {
    return Boolean(room?.choices?.p1?.reveal?.card && room?.choices?.p2?.reveal?.card);
  }

  function seatForPlayer(room) {
    if (room?.players?.p1?.id === online.playerId) return "p1";
    if (room?.players?.p2?.id === online.playerId) return "p2";
    return null;
  }

  function isDuplicateRoomError(error) {
    return error && String(error.code || error.message).includes("23505");
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

  function inviteLink(roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    url.hash = "";
    return url.toString();
  }

  function updateRoomUrl(roomId) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url);
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

  function bootFromRoomLink() {
    const roomId = cleanRoomId(new URLSearchParams(window.location.search).get("room"));
    if (!roomId) return;
    state = createState("online");
    els.roomCodeInput.value = roomId;
    prepareOnlineMode().then(() => joinOnlineRoom(roomId));
  }

  function localRevealKey(round, seat) {
    return `overreachReveal:${online.roomId}:${round}:${seat}`;
  }

  function storeLocalReveal(round, seat, reveal) {
    try {
      window.sessionStorage.setItem(localRevealKey(round, seat), JSON.stringify(reveal));
    } catch {
      online.localReveal = reveal;
    }
  }

  function readLocalReveal(round, seat) {
    try {
      const raw = window.sessionStorage.getItem(localRevealKey(round, seat));
      return raw ? JSON.parse(raw) : online.localReveal;
    } catch {
      return online.localReveal;
    }
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function hashOnlinePick(roomId, round, seat, card, salt) {
    const data = `${roomId}:${round}:${seat}:${card}:${salt}`;
    const bytes = new TextEncoder().encode(data);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  els.modeAiButton.addEventListener("click", () => setMode("ai"));
  els.modeLocalButton.addEventListener("click", () => setMode("local"));
  els.modeOnlineButton.addEventListener("click", () => setMode("online"));
  els.p1NameInput.addEventListener("input", () => updateName("p1", els.p1NameInput.value));
  els.p2NameInput.addEventListener("input", () => updateName("p2", els.p2NameInput.value));
  els.createRoomButton.addEventListener("click", createOnlineRoom);
  els.joinRoomButton.addEventListener("click", () => joinOnlineRoom(els.roomCodeInput.value));
  els.copyInviteButton.addEventListener("click", copyInviteLink);
  els.roomCodeInput.addEventListener("input", () => {
    els.roomCodeInput.value = cleanRoomId(els.roomCodeInput.value);
  });
  els.roomCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinOnlineRoom(els.roomCodeInput.value);
  });
  els.resetButton.addEventListener("click", startNewGame);
  els.startGameButton.addEventListener("click", startGame);
  els.timerToggle.addEventListener("change", () => setTimerEnabled(els.timerToggle.checked));
  els.nextRoundButton.addEventListener("click", advanceLocalRound);
  els.privacyContinueButton.addEventListener("click", continuePrivacy);
  els.rulesButton.addEventListener("click", openRules);
  els.closeRulesButton.addEventListener("click", closeRules);
  els.rulesDialog.addEventListener("click", (event) => {
    if (event.target === els.rulesDialog) closeRules();
  });

  window.OverreachRules = {
    chooseAiCard,
    resolveRound,
    tierFor,
  };

  bootFromRoomLink();
  render();
})();
