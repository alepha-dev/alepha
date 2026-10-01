import { $hook, $inject, Alepha } from "alepha";
import { currentUserAtom } from "alepha/security";

export class ReactAuthProvider {
  protected readonly alepha = $inject(Alepha);

  public readonly onRender = $hook({
    on: "react:server:render:begin",
    handler: async ({ request, state }) => {
      if (request?.user) {
        // Two destinations, and only one of them crosses to the browser.
        //
        // `state.user` is serialized into the page, so `token` and `realm`
        // are stripped from it. `currentUserAtom` is NOT that payload: it is
        // also the first place `$secure` looks for the caller on the server,
        // so storing the stripped copy there made it the authorization
        // context for the rest of the render. Every check after the render
        // began then resolved role names against `realms[0]` instead of the
        // caller's realm, and a user outside the first declared realm was
        // refused a page with `Role '<name>' not found` - naming a role they
        // do hold, in a realm they do not belong to.
        //
        // Invisible with a single realm, where the fallback is always the
        // right answer; it disables the second realm completely.
        const { token, realm, ...clientUser } = request.user;
        this.alepha.store.set(currentUserAtom, request.user);
        state.user = clientUser;
      }
    },
  });
}
