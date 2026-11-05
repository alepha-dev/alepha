import { Alepha, run } from "alepha";

import { HelloApi } from "./app.ts";

// Entry for workerd: the same app, answered through the web request hook.
const app = run(Alepha.create().with(HelloApi));

export default {
  async fetch(request: Request): Promise<Response> {
    await app.start();
    const ctx: { req: Request; res?: Response } = { req: request };
    await app.events.emit("web:request:before", ctx);
    return ctx.res ?? new Response("no response", { status: 500 });
  },
};
