import { resolve } from "path";

const PORT = parseInt(process.env.PORT ?? "3100", 10);
const publicDir = resolve(import.meta.dir, "public");

const clients = new Set<unknown>();
let frameCount = 0;
let lastLog = Date.now();

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    if (server.upgrade(req)) return;

    const url = new URL(req.url);
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(resolve(publicDir, filePath.slice(1)));
    return new Response(file);
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      console.log(`Client connected (${clients.size} total)`);
    },
    message(ws, raw) {
      if (frameCount === 0) console.log(`First message from client (${clients.size} total, relaying to ${clients.size - 1})`);
      frameCount++;

      const now = Date.now();
      if (now - lastLog >= 5000) {
        const rate = (frameCount / ((now - lastLog) / 1000)).toFixed(1);
        console.log(`Relaying ${rate} frames/sec to ${clients.size - 1} consumers`);
        frameCount = 0;
        lastLog = now;
      }

      // Relay to all OTHER clients (adapters)
      const msg = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      for (const client of clients) {
        if (client !== ws) (client as any).send(msg);
      }
    },
    close(ws) {
      clients.delete(ws);
      console.log(`Client disconnected (${clients.size} total)`);
    },
  },
});

console.log(`MediaPipe test server on http://localhost:${server.port}`);
console.log(`WebSocket relay on ws://localhost:${server.port}`);
