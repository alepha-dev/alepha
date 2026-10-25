/**
 * Serve the app shell `alepha capacitor sync --web-only --variant base`
 * built into `dist-capacitor/base/public`, the way a WebView does: every
 * path that is not a file answers `index.html`, and nothing else is behind
 * it. For the browser suite only; `SHELL_PORT` names the port.
 */
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(
  new URL("..", import.meta.url).pathname,
  "dist-capacitor",
  "base",
  "public",
);
const port = Number(process.env.SHELL_PORT);
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

createServer(async (req, res) => {
  const pathname = decodeURIComponent(
    new URL(req.url ?? "/", "http://shell").pathname,
  );
  let file = normalize(join(root, pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  const isFile = await stat(file)
    .then((it) => it.isFile())
    .catch(() => false);
  if (!isFile) {
    file = join(root, "index.html");
  }
  res.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
  });
  res.end(await readFile(file));
}).listen(port, () => {
  console.log(`shell on http://localhost:${port}`);
});
