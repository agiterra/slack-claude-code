#!/usr/bin/env bun
import { startServer } from "@agiterra/slack-tools";

startServer().catch((e) => {
  console.error("[slack] fatal:", e);
  process.exit(1);
});
