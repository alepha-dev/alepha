import { $hook, $inject, Alepha } from "alepha";

export class ReactAuthProvider {
  protected readonly alepha = $inject(Alepha);

  public readonly onRender = $hook({
    on: "react:server:render:begin",
    handler: async ({ request, state }) => {
      if (request?.user) {
        const { token, realm, ...user } = request.user; // do not send token and realm to the client
        this.alepha.state.set("alepha.server.request.user", user); // for hydration, browser, etc...
        state.user = user;
      }
    },
  });
}
