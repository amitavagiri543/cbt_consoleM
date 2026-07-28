/**
 * Production static server for Admin Panel
 * Serves built files and proxies /api requests to backend
 * Usage: node serve.cjs
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 5173;
const DIST = path.join(__dirname, "dist");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const server = http.createServer((req, res) => {
  // Proxy /api and /ws requests to backend
  if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
    const options = {
      hostname: "127.0.0.1",
      port: 3000,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: "localhost:3000" },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", () => {
      res.writeHead(502);
      res.end("Backend unavailable");
    });

    // Propagate client disconnect to backend — critical for SSE close detection.
    req.on("close", () => {
      proxyReq.destroy();
    });
    res.on("close", () => {
      proxyReq.destroy();
    });

    req.pipe(proxyReq);
    return;
  }

  // Serve static files with SPA fallback
  const urlPath = req.url.split("?")[0];
  let filePath = path.join(DIST, urlPath);

  if (!path.extname(filePath)) {
    filePath = path.join(DIST, "index.html");
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, "index.html");
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Admin Panel (production) running at:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://<your-lan-ip>:${PORT}`);
  console.log(`  Proxying /api -> http://127.0.0.1:3000`);
});
