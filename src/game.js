(function () {
  "use strict";

  const CARD_VALUES = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const MAX_ROUNDS = 9;
  const OVERREACH_GAP = 4;
  const TURN_SECONDS = 15;

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
    handOwnerLabel: document.getElementById("handOwnerLabel"),
    historyCount: document.getElementById("historyCount"),
    historyList: document.getElementById("historyList"),
    modeAiButton: document.getElementById("modeAiButton"),
    modeLocalButton: document.getElementById("modeLocalButton"),
    nextRoundButton: document.getElementById("nextRoundButton"),
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
  const defaultNames = {
    ai: { p1: "You", p2: "AI Rival" },
    local: { p1: "Player 1", p2: "Player 2" },
  };
  const namesByMode = {
    ai: { ...defaultNames.ai },
    local: { ...defaultNames.local },
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
    render();
  }

  function currentRoundNumber() {
    return Math.min(state.history.length + 1, MAX_ROUNDS);
  }

  function setMode(mode) {
    if (state.mode === mode) return;
    stopTurnTimer();
    state = createState(mode);
    showToast(mode === "ai" ? "AI duel started." : "Pass-and-play started.");
    render();
  }

  function startNewGame() {
    const mode = state.mode;
    stopTurnTimer();
    state = createState(mode);
    showToast("New game ready.");
    render();
  }

  function startGame() {
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
      state.phase,
      state.history.length,
      state.pending.p1 ?? "none",
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
      startTurnTimer(key);
    }

    updateTurnTimer();
  }

  function startTurnTimer(key) {
    stopTurnTimer();
    turnTimerKey = key;
    turnTimerDeadline = Date.now() + TURN_SECONDS * 1000;
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
    els.modeAiButton.classList.toggle("is-active", aiActive);
    els.modeLocalButton.classList.toggle("is-active", !aiActive);
    els.modeAiButton.setAttribute("aria-pressed", String(aiActive));
    els.modeLocalButton.setAttribute("aria-pressed", String(!aiActive));
  }

  function renderTimerToggle() {
    els.timerToggle.checked = timerEnabled;
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
    if (state.last) {
      els.p1Slot.innerHTML = largeTokenMarkup(state.last.p1Card, "p1");
      els.p2Slot.innerHTML = largeTokenMarkup(state.last.p2Card, "p2");
      return;
    }

    els.p1Slot.innerHTML = '<div class="empty-slot">P1</div>';
    els.p2Slot.innerHTML = '<div class="card-back">Hidden</div>';
  }

  function renderMiniHands() {
    const showP2Numbers = state.mode === "ai";
    els.p1MiniHand.innerHTML = miniHandMarkup(state.hands.p1, true);
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
    els.nextRoundButton.classList.toggle("is-hidden", state.phase !== "between-rounds");
    els.startGameButton.classList.toggle("is-hidden", state.phase !== "setup");

    if (state.phase === "setup") {
      els.handOwnerLabel.textContent = "Ready";
      els.turnPrompt.textContent = "Enter names, then start";
      els.phasePill.textContent = timerEnabled ? "15 seconds per pick" : "Timer off";
      els.resultKicker.textContent = "Setup";
      els.resultText.textContent = "Start when both players are ready.";
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
      els.turnPrompt.textContent = "Pass back for the next pick";
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
    const needsPrivacy = state.phase === "pass-to-p2" || state.phase === "pass-to-p1";
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

  els.modeAiButton.addEventListener("click", () => setMode("ai"));
  els.modeLocalButton.addEventListener("click", () => setMode("local"));
  els.p1NameInput.addEventListener("input", () => updateName("p1", els.p1NameInput.value));
  els.p2NameInput.addEventListener("input", () => updateName("p2", els.p2NameInput.value));
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

  render();
})();
