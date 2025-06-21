import { createServer } from "node:http";

const server = createServer((req, res) => {
	if (req.method === "GET" && req.url === "/ping") {
		res.writeHead(200, { "Content-Type": "text/plain" });
		res.end("pong");
	} else {
		res.writeHead(404);
		res.end();
	}
});

server.listen(3004, () => {
	console.log("Raw server listening on :3004");
});
