# Color Trap

Color Trap is a quick two-player strategy game. Each round draws one pattern, and players choose whether completing it in their own color wins or loses the round.

## Current Product

- 6 by 6 board with a seven-card, no-repeat trap deck
- Computer practice and standard play
- Same-device pass and play
- Private online rooms with invite links, reconnect, realtime updates, and polling fallback
- First-run visual tutorial, exact trap previews, round results, and best-of-five scoring
- Responsive phone and desktop layouts that keep the complete match in one viewport
- Local match recovery, sound and haptic feedback, optional practice hints, and offline local play
- Server-validated online moves with hashed room-seat credentials

## Play Locally

Serve the project folder and open `http://127.0.0.1:5173`.

```powershell
cd overreach
python -m http.server 5173
```

Computer and pass-and-play modes work with a static server. Online rooms require the deployed API and Supabase environment described below.

## Rules

1. A trap is drawn at the start of each round.
2. Red and Blue alternate placing one piece on any empty space.
3. If a move completes the shown trap in that player's own color, that player loses the round.
4. Rotations and mirror images count. Gaps shown inside a trap describe spacing; the spaces do not have to remain empty.
5. The starting color alternates every round. First to three round wins takes the match.

The deck contains Line of 4, Wave, Square, Diamond, Corner, Zigzag, and T Shape. Five-piece traps were removed after simulation showed excessive draw rates on the 6 by 6 board.

## Online Deployment

1. Run `supabase-overreach.sql` in the Supabase SQL editor. Rerun it when upgrading from the earlier public-write room schema.
2. Add these environment variables to Vercel:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

3. Redeploy the project.

`SUPABASE_SERVICE_ROLE_KEY` is used only by `/api/room` and is never returned to the browser. Browsers may read active public board state for Realtime, but all creates, joins, moves, round advances, and rematches are authenticated by an opaque seat token and validated by the server.

Rooms expire after 24 hours. The API removes expired rooms when they are accessed; `delete_expired_color_trap_rooms()` is also available for a scheduled Supabase cleanup job.

## Verify

```powershell
node test/rules.test.js
node test/api.test.js
```

`test/mock-server.js` provides an in-memory two-player room backend for browser journey testing without touching production data.

## Launch Notes

See `MARKET-READINESS.md` for the product audit, completed work, launch gates, recommended metrics, and post-beta roadmap.
