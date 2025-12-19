export const mainTs = () => `
import { $hook, Alepha, run } from "alepha";
import { $logger } from "alepha/logger";

class Hello {
  log = $logger();

  ready = $hook({
    on: "ready",
    handler: () => {
      this.log.info("Hello Alepha!");
    }
  })
}

const alepha = Alepha.create();

alepha.with(Hello);

run(alepha);
`.trim();
