# Pointlezzly Games

One Vercel-ready repository for two browser strategy games:

- `games/color-trap/`: avoid completing the shuffled forbidden shape.
- `games/overreach/`: win a nine-round hidden-token duel without reaching too far.

The repository root is the game picker. Both games support computer, same-device, and private online play.

## Local Preview

```powershell
python -m http.server 5173
```

Open `http://127.0.0.1:5173/`.

## Test

```powershell
npm test
```

## Online Setup

Run both migrations in the same Supabase project:

1. `games/overreach/supabase-overreach.sql`
2. `games/color-trap/supabase-overreach.sql`

Configure these Vercel environment variables:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

The service-role key is used only by the server-side Color Trap room API and is never returned to browsers. Overreach continues to use its security-definer Supabase room functions.

## Deploy

Connect the repository root to Vercel with no build command. Pushing `main` deploys the picker and both games through the existing Git integration.
