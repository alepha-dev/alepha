import autocannon from "autocannon";

const targets = [
	{ name: "Alepha", url: "http://localhost:3003/ping" },
	{ name: "Raw", url: "http://localhost:3004/ping" },
	{ name: "Express", url: "http://localhost:3001/ping" },
	{ name: "Fastify", url: "http://localhost:3002/ping" },
];

for (const { name, url } of targets) {
	const r = await autocannon({
		url,
		connections: 100,
		duration: 10,
	});

	console.log(name, r.requests.sent);
}
