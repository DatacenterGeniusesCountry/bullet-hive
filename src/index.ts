import { Hono } from "hono";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.json({ name: "bullet-hive", status: "ok" });
});

export default app;
