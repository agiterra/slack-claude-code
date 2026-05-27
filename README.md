# slack-claude-code

Claude Code adapter for [slack-tools](https://github.com/agiterra/slack-tools).

## Install

```sh
claude plugin add slack@agiterra -s project
```

## Per-persona setup

Each agent persona maps 1:1 to its own Slack app. Workflow:

1. Create the Slack app at <https://api.slack.com/apps> and install to the target workspace.
2. Add to the persona's `.env`:
   ```sh
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=...
   ```
3. From inside the agent's session: `register_slack_app({workspace: "mivid-studios"})`. Paste the returned Request URL into the Slack app's Event Subscriptions config.
4. Add bot events (`message.channels`, `message.im`, `message.groups`, `message.mpim`, `app_mention`) and save.

The agent's wire channel `webhook.slack` then carries every event. Filter noise via `register_slack_app({filter: "..."})`.

## Tools

- `register_slack_app` — register an event subscription. Returns Slack Request URL.
- `unregister_webhook` — tear down a registration.
- `post_message` — `chat.postMessage`.
- `add_reaction` — `reactions.add`.

See [slack-tools README](https://github.com/agiterra/slack-tools) for details.
