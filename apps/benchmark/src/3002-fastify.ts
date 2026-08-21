import Fastify from "fastify";

const app = Fastify();

app.get("/ping", async () => "pong");

void app.listen({ port: 3002 }).then(() => {
  console.log("Fastify listening on :3002");
});
