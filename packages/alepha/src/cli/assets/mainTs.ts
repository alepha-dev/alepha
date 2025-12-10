export const mainTs = () => `
import { Alepha, run } from "alepha";
import { $logger } from "alepha/logger";

const alepha = Alepha.create();

alepha.with(() => {
  const log = $logger();

  log.info("Hello from Alepha!");
});

run(alepha);
`.trim();
