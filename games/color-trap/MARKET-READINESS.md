# Color Trap Market Readiness

## Product Position

Color Trap's strongest lane is a fast, social strategy game with one memorable inversion: you are building pressure while avoiding your own pattern. It should be marketed as a three-to-five-minute duel, not as a broad board-game platform.

The first release should be a web beta centered on computer practice, pass and play, and private friend rooms. Public matchmaking, ratings, and chat should follow only after retention and balance are proven.

## What Successful Products Teach

- [Chess.com](https://support.chess.com/en/articles/8609779-how-do-i-start-a-game-on-chess-com) makes the default path immediate while keeping bot, friend, and custom play nearby. Color Trap now mirrors that hierarchy with three obvious match choices and no board controls before a match begins.
- [Chess.com Game Review](https://support.chess.com/en/articles/10328363-how-do-i-use-game-review-on-the-app) places rematch and next-action choices directly after a result. Color Trap now uses a dedicated round or match result sheet with a single primary continuation.
- [Plato](https://platoapp.com/en/download) emphasizes cross-platform invites, low friction, lightweight loading, and portrait play. Color Trap now uses a shareable room link, automatic start when the second seat joins, reconnect credentials, and a one-screen phone board.
- [Board Game Arena](https://en.boardgamearena.com/doc/Turn_based_FAQ) treats realtime and asynchronous play as distinct promises with different lobby and timer expectations. Color Trap currently promises realtime private play only; asynchronous games should not be added without notifications and explicit move deadlines.

## Completed In This Pass

- Replaced the crowded always-on dashboard with separate home, online setup, waiting room, game, and result states.
- Added a first-run visual tutorial and precise trap language, including exact spacing rules.
- Rebalanced the deck around three- and four-piece patterns. Simulation of the old assisted rules produced 48 to 82 percent draws for most five-piece traps.
- Removed automatic danger disclosure from standard play. Practice matches and the optional hint toggle retain it for learning.
- Added a no-repeat shuffled trap deck and alternating starting player.
- Added local recovery after refresh, optional sound, haptics, PWA metadata, and offline local assets.
- Made phone and desktop matches fit without horizontal overflow or required game-page scrolling at tested viewports.
- Rebuilt online rooms as create, wait, auto-seat, play, reconnect, result, and mutual-rematch states.
- Moved all online writes behind a server API that validates seat ownership, turn order, occupied spaces, trap completion, and revision conflicts.
- Removed browser write permission from Supabase and separated hashed seat tokens from public match state.

## Launch Gates

The web beta is ready after all of the following are complete:

- Apply the Supabase migration and configure all three production environment variables.
- Run at least 50 human matches across the seven traps and review round length, draw rate, first-player results, and rules confusion by trap.
- Test invite, reconnect, move conflict, room expiry, and rematch on real iOS Safari, Android Chrome, and desktop Chrome/Safari/Edge.
- Add privacy terms and a short player-name policy before collecting analytics or promoting public links.
- Add error monitoring and privacy-conscious product analytics.
- Configure an edge or serverless rate limit for room creation and repeated invalid joins.
- Schedule expired-room cleanup and set budget alerts for database, Realtime, and serverless usage.
- Produce full PWA/app-store icon sizes, social preview art, screenshots, and a support contact.

## Beta Metrics

Track only metrics that answer a product question:

- Home to first move time
- Tutorial completion and tutorial abandonment
- Match start and match completion rates by mode
- Room created to second player joined conversion
- Median invite-to-join time
- Reconnect and room-action error rates
- Round length, draw rate, and winner by starting color and trap
- Rematch request and accepted-rematch rates
- Seven-day returning-player rate

Do not collect board histories or player-entered names in general analytics payloads.

## Post-Beta Roadmap

1. Tune or remove any trap with abnormal draw rate or consistent starting-color bias.
2. Add a daily seeded challenge, personal statistics, and shareable non-spoiler results.
3. Add public matchmaking only with accounts, ratings, abandon handling, rate limits, and abuse controls.
4. Add asynchronous play only with turn deadlines, notifications, and a clear separate lobby choice.
5. Add preset reactions before considering free-text chat; free text creates moderation and safety obligations.
