import { serve } from "bun";

serve({
  port: process.env["PORT"] ?? 3000,
  routes: {
    "/health": new Response("OK"),
    "/*": new Response("Not Found", { status: 404 }),
  },
});
