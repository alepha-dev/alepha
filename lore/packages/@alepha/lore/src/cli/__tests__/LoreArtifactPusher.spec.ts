import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { LoreArtifactPusher } from "../services/LoreArtifactPusher.ts";

class TestPusher extends LoreArtifactPusher {
  public testSchemaOf = this.schemaOf.bind(this);
}

const snapshot = (id: string) =>
  JSON.stringify({ version: "7", dialect: "sqlite", id, ddl: [] });

describe("LoreArtifactPusher.schemaOf (#Q3542)", () => {
  const setup = async () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: LoreArtifactPusher, use: TestPusher });
    await alepha.start();
    return {
      fs: alepha.inject(MemoryFileSystemProvider),
      pusher: alepha.inject(LoreArtifactPusher) as TestPusher,
    };
  };

  it("sends the newest snapshot of each dialect, by folder name", async ({
    expect,
  }) => {
    const { fs, pusher } = await setup();
    await fs.writeFile(
      "/app/migrations/sqlite/20261001000000_first/snapshot.json",
      snapshot("first"),
    );
    await fs.writeFile(
      "/app/migrations/sqlite/20261101000000_second/snapshot.json",
      snapshot("second"),
    );
    await fs.writeFile(
      "/app/migrations/postgres/20261001000000_only/snapshot.json",
      snapshot("only"),
    );

    const sent = JSON.parse((await pusher.testSchemaOf("/app")) as string);

    expect(sent.version).toBe(1);
    expect(sent.dialects.sqlite.id).toBe("second");
    expect(sent.dialects.postgres.id).toBe("only");
  });

  it("skips a newest folder that holds no snapshot", async ({ expect }) => {
    const { fs, pusher } = await setup();
    await fs.writeFile(
      "/app/migrations/sqlite/20261001000000_first/snapshot.json",
      snapshot("first"),
    );
    await fs.writeFile(
      "/app/migrations/sqlite/20261101000000_custom/migration.sql",
      "UPDATE t SET a = 1;",
    );

    const sent = JSON.parse((await pusher.testSchemaOf("/app")) as string);

    expect(sent.dialects.sqlite.id).toBe("first");
  });

  it("sends nothing for a build with no migrations", async ({ expect }) => {
    const { pusher } = await setup();

    expect(await pusher.testSchemaOf("/app")).toBeUndefined();
  });

  it("sends nothing rather than failing the push on a broken snapshot", async ({
    expect,
  }) => {
    const { fs, pusher } = await setup();
    await fs.writeFile(
      "/app/migrations/sqlite/20261001000000_first/snapshot.json",
      "{ not json",
    );

    expect(await pusher.testSchemaOf("/app")).toBeUndefined();
  });
});
