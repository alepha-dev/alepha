import { $hook, $inject, Alepha } from "alepha";
import { currentUserAtom } from "alepha/security";

export class ReactAuthProvider {
  protected readonly alepha = $inject(Alepha);

  public readonly onRender = $hook({
    on: "react:server:render:begin",
    handler: async ({ request, state }) => {
      if (request?.user) {
        const { token, realm, ...user } = request.user; // do not send token and realm to the client
        this.alepha.store.set(currentUserAtom, user);
        state.user = user;
      }
    },
  });
}
