import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";

function readNodeRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function localApiBridgePlugin(): Plugin {
  return {
    name: "certpulse-local-api",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        if (!req.url?.startsWith("/api")) {
          return next();
        }
        try {
          const mod = await server.ssrLoadModule("/api/index.ts");
          const method = (req.method || "GET").toUpperCase();
          const hasBody = method !== "GET" && method !== "HEAD";
          const rawBody = hasBody ? await readNodeRequestBody(req) : undefined;
          const host = req.headers.host || "localhost:5173";
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers.set(k, v);
            else if (Array.isArray(v)) headers.set(k, v.join(", "));
          }
          const webReq = new Request(`http://${host}${req.url}`, {
            method,
            headers,
            body: hasBody && rawBody && rawBody.length > 0 ? new Uint8Array(rawBody) : undefined,
          });
          const webRes: Response = await mod.app.fetch(webReq);
          res.statusCode = webRes.status;
          webRes.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          const buf = Buffer.from(await webRes.arrayBuffer());
          res.end(buf);
        } catch (err) {
          console.error("[vite-api-bridge]", err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Local API middleware error" }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApiBridgePlugin()],
  build: {
    outDir: "dist",
  },
});
