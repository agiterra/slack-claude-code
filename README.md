# slack-claude-code

Claude Code adapter for [slack-tools](https://github.com/agiterra/slack-tools).

## Install

```sh
/plugin marketplace add agiterra/claude-marketplace   # one-time
/plugin install slack@agiterra
```

## Per-persona setup

Each agent persona maps 1:1 to its own Slack app. Workflow:

1. Create the Slack app at <https://api.slack.com/apps> and install to the target workspace. **Turn Socket Mode OFF** — with it on, Slack delivers events over an outbound WebSocket and never POSTs to the Wire gateway, so the webhook stays silent.
2. Grant the bot the scopes you need (`channels:history`, `groups:history`, `im:history`, `mpim:history`, `chat:write`, `reactions:write`, `users:read`; add `users:read.email` for email lookup). See the [slack-tools README](https://github.com/agiterra/slack-tools) for the full list.
3. Add to the persona's `.env`:
   ```sh
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=...
   SLACK_WORKSPACE=mivid-studios   # this persona's workspace label
   SLACK_BOT_USER_ID=U0123456789   # optional — defaults a self-echo filter
   ```
   The plugin also reads `AGENT_ID`, `AGENT_PRIVATE_KEY`, and `WIRE_URL` — these come from the persona's wire-plugin registration and are already in its env. Wire API calls (register + self-heal) are signed with `AGENT_PRIVATE_KEY` (Ed25519 PKCS8 base64); without it the server logs `Wire auth disabled` and registration silently no-ops. Behind ngrok, set `WIRE_EXTERNAL_URL` to the externally-reachable Wire URL — that is the URL the pasted Slack Request URL is built from.
4. From inside the agent's session, call `register_slack_app()` **with no arguments**. Paste the returned Request URL into the Slack app's Event Subscriptions config.
5. Add bot events (`message.channels`, `message.im`, `message.groups`, `message.mpim`, `app_mention`) and save.

The agent's wire channel `webhook.slack` then carries every event. Filter noise via `register_slack_app({filter: "..."})`, or set `SLACK_BOT_USER_ID` to drop the bot's own echoes by default.

### Reliability: dedup + immediate ACK

Slack expects a `2xx` within ~3s or it re-delivers an event up to 3× (`X-Slack-Retry-Reason: http_timeout`). Under transient gateway latency that turns one event into 3–4 duplicates on the channel. Registrations from slack-tools ≥ v0.5.0 harden against this:

- **`dedup: "payload.event_id"`** — Slack stamps every delivery (incl. retries) with the same top-level `event_id`. Wire keys idempotency on it and drops retries at the broker (`{duplicate:true}`), so a retry is never re-fanned to subscribers.
- **`ack_early: true`** — Wire ACKs Slack's POST with `200` the instant the message is persisted, then fans out asynchronously (requires Wire with the `ack_early` webhook flag). This decouples Slack's retry clock from delivery latency, so timeouts (and thus retries) stop happening in the first place.

Both ride the normal registration body, so a **fresh** registration is covered automatically. A webhook registered *before* the upgrade keeps its prior config until re-registered (idempotent re-registration leaves existing rows untouched — see below); an operator can also set the two columns on the live row directly.

### Omit the `workspace` param

`SLACK_WORKSPACE` is the **single source of truth** for this persona's webhook identity. Call `register_slack_app()` with no `workspace` — it reads the env var. The same env value is what the plugin uses to heal the webhook on boot (below), so passing an explicit `workspace` risks registering a *second* webhook under a different label that diverges from the one the boot self-heal maintains. Only pass `workspace` to register an additional/ad-hoc workspace on purpose.

## Self-healing on boot

**Contract: a permanent-agent plugin is responsible for healing its own webhooks on boot.** Wire's janitor no longer sweeps permanent agents' webhooks (wire v1.14.0), but a stale registration can still arise from a manual delete, a dropped row on schema migration, or a fresh Wire DB. To recover without a human noticing the firehose went silent:

- When `AGENT_ID` + `SLACK_WORKSPACE` + `SLACK_SIGNING_SECRET` are all set (and `AGENT_PRIVATE_KEY` is present for Wire auth), the MCP server idempotently re-registers its webhook every time it starts (i.e. each session).
- Registration is idempotent against Wire ≥ v1.15.0: if the webhook already exists it is left untouched (`registered:false`) — no URL churn, no secret/filter overwrite.
- The self-heal is best-effort and log-only; a failure (e.g. Wire briefly unreachable, or no private key) is logged to stderr and never blocks the server or the session.

No SessionStart hook is required — the healing rides the MCP server's own startup.

## Tools

- `register_slack_app` — register an event subscription (idempotent; reads `SLACK_WORKSPACE` env — call with no args). Optional `filter`, `signing_secret`, and `session_id` (session-scoped webhook, purged when the session ends; default is agent-scoped). Returns the Slack Request URL.
- `unregister_webhook` — tear down a registration by wire webhook id.
- `post_message` — `chat.postMessage` (optional `thread_ts`, `blocks`).
- `add_reaction` — `reactions.add`.

See [slack-tools README](https://github.com/agiterra/slack-tools) for details.
