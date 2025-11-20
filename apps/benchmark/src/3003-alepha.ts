import { Alepha, run } from "alepha";
import { $route, ServerProvider } from "alepha/server";

class App {
  ping = $route({
    path: "/ping",
    handler: () => "pong",
  });
}

const alepha = Alepha.create({
  env: {
    NODE_ENV: "production",
    LOG_LEVEL: "error",
    SERVER_PORT: 3003,
  },
});

alepha.with(App);

run(alepha, {
  ready: () => {
    console.log(
      `Alepha server listening on ${alepha.inject(ServerProvider).hostname}`,
    );
  },
});
