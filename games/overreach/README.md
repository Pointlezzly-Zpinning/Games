# Overreach

A dependency-free browser version of the nine-round hidden-pick token game, with AI, pass-and-play, and secure private online matches.

## Play locally

Open `index.html` in a browser, or serve the folder with any static file server.

```powershell
cd overreach
python -m http.server 5173
```

Then visit `http://localhost:5173`.

## Modes

- `VS AI`: play against a tactical browser AI.
- `2 Player`: pass-and-play mode that hides each pick between turns.
- `Online`: create a private room, share the invite link, and play from two phones with simultaneous hidden picks.

## Online rooms with Supabase

Run `supabase-overreach.sql` in your Supabase SQL editor. The migration creates the private `overreach_rooms_v2` table and the room RPC functions used by the browser. Then add these Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Redeploy after adding the variables. The app reads them from `/api/supabase-config`.

The browser never receives direct table access. Each device owns a private room secret, and all joins, picks, timeouts, round resolution, reconnects, and rematches run through validated `security definer` functions. Room updates are row-locked and atomic, so simultaneous picks can resolve only once. Clients poll a sanitized room view for responsive reconnect-safe play.

Rooms expire after 24 hours and are cleaned up as new rooms are created. Explicitly leaving a room ends it for both players.

Opponent tokens are visible only during the brief round reveal. Afterward, each player can see only their own spent-token history and the opponent's remaining token count; opponent values are removed from the sanitized room response.

## Rules

Each player has tokens `1` through `9`. Each round, both players spend one unused token. The higher token wins and scores its own value, unless it is more than `4` higher than the other token. In that case it overreaches, busts, and the lower token wins instead. Same number ties. After nine rounds, highest score wins; if score is tied, most round wins decides it.

## Verify

```powershell
node test/rules.test.js
```

## Deploy later

This is a static app with one small Vercel API endpoint for Supabase config. Use the repo root in Vercel; no build command is required.
