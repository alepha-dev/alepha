import { run } from "@alepha/core";
import { $route } from "@alepha/server";

class App {
  ping = $route({
    path: "/ping",
    handler: () => "pong",
  });
}

run(App, {
  cluster: true,
  env: {
    LOG_LEVEL: "silent",
    SERVER_PORT: 3005,
  },
  ready: () => {
    console.log("Alepha server listening on :3005");
  },
});
