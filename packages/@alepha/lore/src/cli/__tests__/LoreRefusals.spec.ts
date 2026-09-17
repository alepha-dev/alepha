import { $inject, Alepha, AlephaError, z } from "alepha";
import { CommandError } from "alepha/command";
import {
  $secure,
  AlephaSecurity,
  JwtProvider,
  SecurityProvider,
} from "alepha/security";
import { $action, ForbiddenError, ServerProvider } from "alepha/server";
import {
  $client,
  AlephaServerLinks,
  AlephaServerLinksClient,
} from "alepha/server/links";
import { describe, it } from "vitest";

import { LoreClientService } from "../services/LoreClientService.ts";
import {
  type LoreRefusalContext,
  LoreRefusals,
} from "../services/LoreRefusals.ts";

/**
 * A Lore-shaped server: one action any signed-in user may call, one only an
 * admin may, and one that refuses the way `RankService.refusal` does.
 */
class Board {
  listCards = $action({
    use: [$secure()],
    schema: { response: z.text() },
    handler: () => "cards",
  });

  archiveBoard = $action({
    use: [$secure({ roles: ["admin"] })],
    schema: { response: z.text() },
    handler: () => "archived",
  });

  createCard = $action({
    use: [$secure()],
    schema: { response: z.text() },
    handler: (): string => {
      throw new ForbiddenError(
        "Your rank (Contributor) does not grant quest:create. Ask somebody who holds rank:manage.",
      );
    },
  });
}

/**
 * A command's side of it: the client every `lore` command builds, and the
 * guard around its work.
 */
class BoardCommands {
  public readonly client = $inject(LoreClientService);
  public readonly refusals = $inject(LoreRefusals);
  public readonly api = $client<Board>(this.client.scope());
}

/**
 * ⚠️ Two containers, as in `release-cli-publish.spec.ts`: the CLI's `$env`
 * resolves `LORE_URL` when its container is created, and the server's port is
 * only known once the server has started.
 */
const serve = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaServerLinks)
    .with(AlephaSecurity)
    .with(Board);
  await alepha.start();

  const jwt = alepha.inject(JwtProvider);
  const realm = alepha.inject(SecurityProvider).getRealms()[0]?.name;
  const token = await jwt.create({ sub: "u1", roles: [] }, realm, {
    header: { typ: jwt.accessTokenTyp },
  });

  return { hostname: alepha.inject(ServerProvider).hostname, token };
};

const cli = async (env: Record<string, string>) => {
  const alepha = Alepha.create({
    // Every Lore variable blanked unless a case sets it, and `HOME` pointed
    // nowhere, so a `lore login` done on this machine cannot answer for the
    // credential.
    env: {
      LOG_LEVEL: "error",
      LORE_API_KEY: "",
      LORE_URL: "",
      LORE_PROJECT: "",
      HOME: "/nonexistent",
      ...env,
    },
  }).with(AlephaServerLinksClient);
  const commands = alepha.inject(BoardCommands);
  await alepha.start();
  return commands;
};

const refusal = async (
  commands: BoardCommands,
  work: () => Promise<unknown>,
): Promise<CommandError> => {
  const context: LoreRefusalContext = { project: "alepha" };
  const error = await commands.refusals.guard(context, work).then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof CommandError)) {
    throw new AlephaError(`Expected a CommandError, got ${String(error)}`);
  }
  return error;
};

describe("LoreRefusals", () => {
  it("exits 3 with no credential, naming both fixes", async ({ expect }) => {
    const { hostname } = await serve();
    const commands = await cli({ LORE_URL: hostname });

    const error = await refusal(commands, () => commands.api.listCards());

    expect(error.exitCode).toBe(3);
    expect(error.message).toContain(`Not authenticated to ${hostname}`);
    expect(error.message).toContain("lore login");
    expect(error.message).toContain("LORE_API_KEY");
  });

  /**
   * The row a stubbed client gets wrong. The server swallows a bearer it
   * cannot resolve and answers the registry as if nobody had asked, so the
   * failure arrives as `Action listCards not found.`
   */
  it("exits 3 when the credential is not accepted, naming a Lore without the action too", async ({
    expect,
  }) => {
    const { hostname } = await serve();
    const commands = await cli({
      LORE_URL: hostname,
      LORE_API_KEY: "revoked-or-expired",
    });

    const error = await refusal(commands, () => commands.api.listCards());

    expect(error.exitCode).toBe(3);
    expect(error.message).toContain("Action listCards not found.");
    expect(error.message).toContain(
      `the credential for ${hostname} was not accepted`,
    );
    expect(error.message).toContain("lore login");
    expect(error.message).toContain("LORE_API_KEY");
    expect(error.message).toContain("this Lore does not have listCards");
  });

  it("exits 4 when the registry withholds the action, naming it and the key's scope", async ({
    expect,
  }) => {
    const { hostname, token } = await serve();
    const commands = await cli({ LORE_URL: hostname, LORE_API_KEY: token });

    const error = await refusal(commands, () => commands.api.archiveBoard());

    expect(error.exitCode).toBe(4);
    expect(error.message).toContain(
      "Action archiveBoard is not allowed for this user.",
    );
    expect(error.message).toContain("permission scope of LORE_API_KEY");
  });

  it("exits 4 on a rank refusal, prefixing the project and keeping the server's sentence", async ({
    expect,
  }) => {
    const { hostname, token } = await serve();
    const commands = await cli({ LORE_URL: hostname, LORE_API_KEY: token });

    const error = await refusal(commands, () => commands.api.createCard());

    expect(error.exitCode).toBe(4);
    expect(error.message).toBe(
      "Project alepha: Your rank (Contributor) does not grant quest:create. Ask somebody who holds rank:manage.",
    );
  });

  it("exits 1 on an unreachable remote, naming the host and never 4", async ({
    expect,
  }) => {
    const commands = await cli({
      LORE_URL: "http://127.0.0.1:1",
      LORE_API_KEY: "any",
    });

    const error = await refusal(commands, () => commands.api.listCards());

    expect(error.exitCode).toBe(1);
    expect(error.message).toContain(
      "Could not reach Lore at http://127.0.0.1:1",
    );
  });

  it("passes a success through, and an error it does not know unchanged", async ({
    expect,
  }) => {
    const { hostname, token } = await serve();
    const commands = await cli({ LORE_URL: hostname, LORE_API_KEY: token });
    const unknown = new RangeError("not a refusal");

    expect(
      await commands.refusals.guard({}, () => commands.api.listCards()),
    ).toBe("cards");
    await expect(
      commands.refusals.guard({}, async () => {
        throw unknown;
      }),
    ).rejects.toBe(unknown);
  });
});
