Bun.serve({
  port: 3006,
  fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/ping") {
      return new Response("pong", {
        headers: { "Content-Type": "text/plain" },
      });
    }
    return new Response(null, { status: 404 });
  },
});

console.log("Raw Bun server listening on :3006");
