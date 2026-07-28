/**
 * Production static server for Exam Portal
 * Serves at /examportal/* and proxies /api to backend
 * Usage: node serve.cjs
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 5174;
const BACKEND = "http://127.0.0.1:3000";
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
  const urlPath = (req.url || "/").split("?")[0];

  // Proxy /api requests to backend
  if (urlPath.startsWith("/api") || urlPath.startsWith("/ws")) {
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
    // Without this, when the candidate closes the browser tab, the backend
    // never sees the connection close and the auto-pause never fires.
    req.on("close", () => {
      proxyReq.destroy();
    });
    res.on("close", () => {
      proxyReq.destroy();
    });

    req.pipe(proxyReq);
    return;
  }

  // Redirect root to /examportal
  if (urlPath === "/" || urlPath === "") {
    res.writeHead(302, { Location: "/examportal/" });
    res.end();
    return;
  }

  // Strip /examportal prefix for file lookup
  let fileLookup = urlPath;
  if (fileLookup.startsWith("/examportal")) {
    fileLookup = fileLookup.slice("/examportal".length) || "/";
  }

  // Try to serve static file
  let filePath = path.join(DIST, fileLookup);

  // If it's a directory or has no extension, serve index.html (SPA)
  if (!path.extname(filePath) || !fs.existsSync(filePath)) {
    filePath = path.join(DIST, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST, "index.html");
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(content);
  } catch (err) {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Exam Portal (production) running at:");
  console.log("  Local:   http://localhost:" + PORT + "/examportal");
  console.log("  Network: http://10.0.4.39:" + PORT + "/examportal");
  console.log("  Proxying /api -> " + BACKEND);
});
