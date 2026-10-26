# AI Agent Relay

A single page for handing work from one AI tool to the next when a free quota runs out. It keeps a living context packet, a chain of tools, and a searchable history of hops and decisions.

It does **not** read other sites’ chats, switch tools by itself, or let agents message each other.

Shared-session search and the human checklist are ideas borrowed from the open-source [Agent Relay](https://github.com/agentworkforce/relay) project by Agent Workforce, licensed Apache-2.0. This site does not include that project’s code.

## Use it

1. Name the project.
2. Tap **+ Add AI tool**, or tap a preset (ChatGPT, Base44, Cursor, Buffer, Linear, Replit, Perplexity, Link by Stripe, and the older presets).
3. Fill in the goal, current state, and **Decisions**. Add must-do rules and required steps if you want them in every handoff.
4. Tap **Continue in next tool**. That copies a full handoff and opens the next tool that still has quota today.
5. When that tool replies, paste the reply back. If it contains a `Decisions:` section, those lines are added to Decisions.
6. Tick the required steps yourself, then **Mark hop done**. Until they are ticked, that hop stays open.

The daily counter is what you tap (**+1 used**, **I hit the limit**). It resets at midnight on this device. RunPod and OpenRouter can also show a live balance when the server keys below are set. Every other tool, including Boundless and DeepSeek, is marked **Manual**.

Your work is saved in this browser immediately. **Save to cloud** copies it to Supabase. **Export backup** downloads a JSON file. Old `relay-v1` browser data is kept and upgraded in place.

## What Casey needs to set on Vercel

Project → Settings → Environment Variables. Then redeploy.

| Name | Required? | What it does |
| --- | --- | --- |
| `OWNER_EMAIL` | Yes, for live balances | Only this signed-in email can see RunPod and OpenRouter balances. |
| `RUNPOD_API_KEY` | Only if you want RunPod’s balance | Server-side GraphQL `myself { clientBalance, currentSpendPerHr }`. If it is missing, the card says **Not connected**. |
| `OPENROUTER_API_KEY` | Only if you want OpenRouter’s balance | Server-side `GET /api/v1/key` and, when the key is allowed, `GET /api/v1/credits`. If it is missing, the card says **Not connected**. |
| `SUPABASE_URL` | No | Defaults to the project already used by the page (`https://inlqueorerrsmfnaryzj.supabase.co`). Set it only if the Supabase project changes. |
| `SUPABASE_ANON_KEY` | No | Defaults to the publishable key already in the page. Set it only if that key changes. |

Provider keys stay on the server. The browser only receives balances, and only after Supabase confirms the signed-in email matches `OWNER_EMAIL`.

## Supabase SQL for share links

Share links need one new table. Cloud save of the whole relay still uses the existing `relay_workspaces` table. This SQL does not change that table.

1. Open the Supabase dashboard for this project.
2. Go to **SQL Editor → New query**.
3. Paste the file `supabase/migrations/20261026120000_relay_handoffs.sql` and run it.
4. Sign in on the site and tap **Create a read-only share link**.

The link looks like `https://ai-agent-relay.vercel.app/h/<id>`. Anyone with that link can read that one handoff. They cannot list your other handoffs. If the SQL has not been run, the button says so instead of pretending the link exists.

## Icons

Preset marks are real logos: Simple Icons (CC0) for the monochrome marks, and the public app icons for Base44, Link by Stripe, Gemini, RunPod, and Boundless. A tool you add by URL uses that site’s favicon. If the favicon fails to load, the card shows a colored initial.
