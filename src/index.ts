import { Hono } from "hono";
import type { Env } from "./types";
import publish from "./routes/publish";
import fetch_ from "./routes/fetch";
import sync from "./routes/sync";
import { handleCron } from "./cron";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.json({ name: "bullet-hive", status: "ok" });
});

app.route("/publish", publish);
app.route("/fetch", fetch_);
app.route("/sync", sync);

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(handleCron(env));
  },
};
