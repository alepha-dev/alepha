import { spawn } from "node:child_process";
import autocannon from "autocannon";

const targets = [
  { name: "Express", url: "http://localhost:3001/ping" },
  //{ name: "Fastify", url: "http://localhost:3002/ping" },
  { name: "Alepha", url: "http://localhost:3003/ping" },
  { name: "Alepha-Bun", url: "http://localhost:3005/ping" },
  // { name: "Raw", url: "http://localhost:3004/ping" },
];

const p = spawn("npm run concurrent", {
  shell: true,
  stdio: "inherit",
});

await new Promise((resolve) => {
  setTimeout(resolve, 2000);
});

console.log("=====================");
console.log("Ready...");
for (let i = 3; i > 0; i--) {
  console.log(i, "...");
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });
}

console.log("Go!");
console.log("=====================");

for (const { name, url } of targets) {
  console.log("=", `${name}...`);

  const result = await autocannon({
    url,
    connections: 100,
    duration: 10,
  });

  console.log("=", name, result.requests.sent);
}

console.log("=====================");

p.kill();
