import { $hook, $inject, Alepha, z } from "alepha";
import {
  $action,
  AlephaServer,
  ServerProvider,
  type ServerRequest,
} from "alepha/server";
import { MultipartCapProvider } from "alepha/server/multipart";
import { describe, test } from "vitest";
import { AlephaSecurity } from "../index.ts";
import { SecurityProvider } from "../providers/SecurityProvider.ts";

/**
 * Answers for any request, so the test is about *when* the user is resolved
 * rather than about how a credential is read.
 */
class FixedUserSecurityProvider extends SecurityProvider {
  public override async resolveUserFromServerRequest(): Promise<any> {
    return { id: "u1", name: "Alice", roles: [] };
  }
}

class Upload {
  send = $action({
    method: "POST",
    path: "/upload",
    schema: {
      body: z.object({ file: z.file() }),
      response: z.text(),
    },
    handler: async () => "ok",
  });
}

describe("the user is resolved before the body is read", () => {
  /**
   * What this buys, concretely: a size budget can key on *who is calling*
   * instead of on a query parameter the caller picked. Resolution needs only
   * the URL and the headers, so it has nothing to wait for — running it after
   * the body hook meant a resolver could never see a user, and the only handle
   * left was attacker-controlled.
   *
   * It does **not** gate the parse. `$secure` authorises later, in the handler
   * chain, so the bytes of a `z.file()` field are still buffered before anyone
   * is refused. That distinction is the whole reason the previous docblock here
   * was wrong: ordering resolves identity, it does not authorise.
   */
  test("a multipart cap resolver can see the caller", async ({ expect }) => {
    let seen: unknown = "resolver never ran";

    class Caps {
      protected readonly caps = $inject(MultipartCapProvider);
      register = $hook({
        on: "configure",
        handler: () => {
          this.caps.use((request: ServerRequest) => {
            seen = request.user;
            return undefined;
          });
        },
      });
    }

    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: SecurityProvider, use: FixedUserSecurityProvider })
      .with(AlephaServer)
      .with(AlephaSecurity)
      .with(Upload)
      .with(Caps);
    await alepha.start();

    const body = new FormData();
    body.append("file", new File(["hello"], "a.txt", { type: "text/plain" }));

    await fetch(`${alepha.inject(ServerProvider).hostname}/api/upload`, {
      method: "POST",
      body,
    });

    expect(seen).toMatchObject({ id: "u1" });
  });
});
