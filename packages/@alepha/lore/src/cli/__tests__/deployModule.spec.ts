import { Alepha, type Service } from "alepha";
import { AlephaCommand, CliProvider } from "alepha/command";
import { LinkProvider } from "alepha/server/links";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { AlephaLoreDeploy } from "../AlephaLoreDeploy.ts";
// ⚠️ Imported even where it is not used: evaluating `AlephaLoreCli` sets the
// `[MODULE]` back-reference of everything IT declares. Without it, a service
// moved back beside the commands would still pass here, since nothing in this
// file would have told the service which module it belongs to.
import { AlephaLoreCli } from "../index.ts";
import { ArtifactUploader } from "../services/ArtifactUploader.ts";
import { GitContextService } from "../services/GitContextService.ts";
import { LoreArtifactPusher } from "../services/LoreArtifactPusher.ts";
import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreDeployer } from "../services/LoreDeployer.ts";
import { LoreDeviceLogin } from "../services/LoreDeviceLogin.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";
import { LoreSecretsService } from "../services/LoreSecretsService.ts";
import { LoreTokenStore } from "../services/LoreTokenStore.ts";

/**
 * The mirror of `commandSurface.spec.ts`: what injecting a deploy service
 * brings with it.
 *
 * ⚠️ `Alepha.inject` registers the module that DECLARES a service. The
 * platform adapter injects these from inside the `alepha` binary, so if any of
 * them were declared beside the `lore` commands, `alepha --help` would grow
 * every Lore verb. `AlephaLoreDeploy` holds them for exactly that reason, and
 * this is what keeps it command-free.
 */
describe("the Lore deploy module", () => {
  const services: Array<[string, Service]> = [
    ["LoreClientService", LoreClientService],
    ["LoreTokenStore", LoreTokenStore],
    ["LoreProjectResolver", LoreProjectResolver],
    ["GitContextService", GitContextService],
    ["ArtifactUploader", ArtifactUploader],
    ["LoreArtifactPusher", LoreArtifactPusher],
    ["LoreDeployer", LoreDeployer],
    ["LoreSecretsService", LoreSecretsService],
    ["LoreDeviceLogin", LoreDeviceLogin],
  ];

  const bare = () =>
    Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: LinkProvider, use: LinkProvider })
      .with(AlephaCommand);

  it.each(services)("injecting %s registers no command", (_name, service) => {
    const alepha = bare();

    alepha.inject(service);

    expect(alepha.inject(CliProvider).commands.map((it) => it.name)).toEqual(
      [],
    );
  });

  it("declares every one of them, so none drags another module in", () => {
    const alepha = bare().with(AlephaLoreDeploy);

    for (const [, service] of services) {
      alepha.inject(service);
    }

    expect(alepha.inject(CliProvider).commands).toEqual([]);
  });

  it("is still what the `lore` binary deploys with, through its import", () => {
    const alepha = bare().with(AlephaLoreCli);

    const names = alepha.inject(CliProvider).commands.map((it) => it.name);

    expect(names).toContain("deploy");
    expect(alepha.inject(LoreDeployer)).toBeInstanceOf(LoreDeployer);
  });
});
