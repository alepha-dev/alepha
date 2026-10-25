/**
 * Lets a Node script import the web barrels (#E75): a `@lore/*` web module
 * reaches `@alepha/ui`, whose components import stylesheets, which Node cannot
 * load. Each `.css` import resolves to an empty module instead. Registered
 * after `tsx`, so it runs first.
 */
import { registerHooks } from "node:module";

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return {
        format: "module",
        source: "export default {};",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
