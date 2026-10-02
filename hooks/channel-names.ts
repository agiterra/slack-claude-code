#!/usr/bin/env bun
/**
 * channel-names.ts — UserPromptSubmit hook: put Slack channel NAMES next to the ids in a
 * webhook.slack event (Tim, 2026-09-04 via Herald: "events arrive as channel IDs only … names are
 * valuable context; add the channel name deterministically in the Slack plugin, cache names, lazy-load").
 *
 * Stdin: {"prompt": "..."}. If the prompt carries a Slack event, every conversation id in it
 * (C… public channel, G… private group, D… DM, plus mpdm) is resolved with conversations.info
 * (DMs: users.info for the counterpart) using the bot token, cached in ~/.wire/slack-channel-names.json
 * and reused across invocations. Output is additionalContext — the event text itself is untouched.
 * Silent (exit 0, no output) when there is no Slack event, no token, or the API is unreachable:
 * a hook must never block a turn. Token: SLACK_BOT_TOKEN env, else ~/.wire/slack-creds.env.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const home = process.env.HOME ?? "/tmp";
const cachePath = join(home, ".wire", "slack-channel-names.json");
const TTL_MS = 7 * 24 * 3600 * 1000;

function loadToken(): string | null {
  const env = process.env.SLACK_BOT_TOKEN?.trim();
  if (env) return env;
  for (const f of [join(home, ".wire", "slack-creds.env"), join(process.cwd(), ".env")]) {
    try {
      const m = readFileSync(f, "utf8").match(/^SLACK_BOT_TOKEN=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* next */ }
  }
  return null;
}

type Entry = { label: string; at: number };
function loadCache(): Record<string, Entry> {
  try { return JSON.parse(readFileSync(cachePath, "utf8")); } catch { return {}; }
}
function saveCache(c: Record<string, Entry>): void {
  try { mkdirSync(join(home, ".wire"), { recursive: true }); writeFileSync(cachePath, JSON.stringify(c)); } catch { /* best effort */ }
}

async function slack<T>(method: string, token: string, params: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(4000),
    });
    const d = (await res.json()) as { ok: boolean } & T;
    return d.ok ? d : null;
  } catch { return null; }
}

async function resolve(id: string, token: string): Promise<string | null> {
  const info = await slack<{ channel: { name?: string; is_im?: boolean; is_mpim?: boolean; is_private?: boolean; is_channel?: boolean; user?: string } }>(
    "conversations.info", token, { channel: id });
  if (!info) return null;
  const c = info.channel;
  if (c.is_im && c.user) {
    const u = await slack<{ user: { name?: string; real_name?: string } }>("users.info", token, { user: c.user });
    const who = u?.user.real_name || u?.user.name || c.user;
    return `DM with ${who}`;
  }
  if (c.is_mpim) return `group DM ${c.name ?? id}`;
  if (c.name) return `#${c.name}${c.is_private ? " (private)" : ""}`;
  return null;
}

async function main(): Promise<void> {
  let prompt = "";
  try { prompt = (JSON.parse(await Bun.stdin.text()) as { prompt?: string }).prompt ?? ""; } catch { return; }
  if (!prompt.includes("webhook.slack") && !/topic="slack"/.test(prompt)) return;
  const ids = [...new Set([...prompt.matchAll(/"channel"\s*:\s*"([CDG][A-Z0-9]{8,})"/g)].map((m) => m[1]))];
  if (ids.length === 0) return;
  const token = loadToken();
  const cache = loadCache(); const now = Date.now(); let dirty = false; const lines: string[] = [];
  for (const id of ids) {
    let e = cache[id];
    if ((!e || now - e.at > TTL_MS) && token) {
      const label = await resolve(id, token);
      if (label) { e = { label, at: now }; cache[id] = e; dirty = true; }
    }
    if (e) lines.push(`${id} = ${e.label}`);
  }
  if (dirty) saveCache(cache);
  if (lines.length === 0) return;
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `Slack channel names: ${lines.join("; ")}` } }));
}
main().catch(() => { /* never block a turn */ });
