# Overreach

A dependency-free browser version of the nine-round hidden-pick token game.

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
- `Online`: create a room, send the invite link, and play from two phones with simultaneous hidden picks.

## Online rooms with Supabase

Run `supabase-overreach.sql` in your Supabase SQL editor. Then add these Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Redeploy after adding the variables. The app reads them from `/api/supabase-config`.

The online mode uses one `overreach_rooms` row per game room and subscribes to Supabase Realtime updates for that room. Picks are committed as hashes first and revealed only after both players lock in.

## Rules

Each player has tokens `1` through `9`. Each round, both players spend one unused token. The higher token wins and scores its own value, unless it is more than `4` higher than the other token. In that case it overreaches, busts, and the lower token wins instead. Same number ties. After nine rounds, highest score wins; if score is tied, most round wins decides it.

## Verify

```powershell
node test/rules.test.js
```

## Deploy later

This is a static app with one small Vercel API endpoint for Supabase config. When you connect it to GitHub and Vercel, use the repo root. No build command is required.
