// Servidor local mínimo para probar el generador: npm start → http://localhost:4173
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 4173;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".md": "text/plain; charset=utf-8" };

http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.join(ROOT, name.endsWith("/") ? name + "index.html" : name);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end("No encontrado");
    return;
  }
  response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
}).listen(PORT, "127.0.0.1", () => console.log(`Generador en http://localhost:${PORT}`));
