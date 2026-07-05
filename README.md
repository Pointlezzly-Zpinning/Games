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

## Rules

Each player has tokens `1` through `9`. Each round, both players spend one unused token. The higher token wins and scores its own value, unless it is more than `4` higher than the other token. In that case it overreaches, busts, and the lower token wins instead. Same number ties. After nine rounds, highest score wins; if score is tied, most round wins decides it.

## Verify

```powershell
node test/rules.test.js
```

## Deploy later

This is a static app. When you connect it to GitHub and Vercel, set the Vercel project root to this `overreach` folder. No build command is required.
