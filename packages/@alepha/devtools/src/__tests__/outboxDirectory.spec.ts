import { mkdirSync } from "node:fs";

import { Alepha } from "alepha";
import { localEmailOptions } from "alepha/email";
import { AlephaServer, ServerProvider } from "alepha/server";
import { localSmsOptions } from "alepha/sms";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { beforeAll, describe, it } from "vitest";

import { AlephaDevtools } from "../index.ts";

// The module serves its built UI from `assets/ui`, a gitignored build artifact
// that is absent in CI. Same shim as DevToolsProvider.spec.ts.
beforeAll(() => {
  mkdirSync(new URL("../../assets/ui", import.meta.url), { recursive: true });
});

describe("the devtools outbox", () => {
  const boot = async (dirs: { emails: string; sms: string }) => {
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with(AlephaServer)
      .with(AlephaDevtools);

    // What an app does when it moves its scratch data out of the bundle -
    // which is what `DATA_DIR` does for it in production.
    alepha.store.set(localEmailOptions.key, { directory: dirs.emails });
    alepha.store.set(localSmsOptions.key, { directory: dirs.sms });

    await alepha.start();
    return { alepha, fs: alepha.inject(MemoryFileSystemProvider) };
  };

  it("reads SMS from the configured directory, not the default", async ({
    expect,
  }) => {
    const { alepha, fs } = await boot({
      emails: "/data/emails",
      sms: "/data/sms",
    });

    await fs.mkdir("/data/sms", { recursive: true });
    await fs.writeFile(
      "/data/sms/+33600000000,2026-01-01T00-00-00-000Z.sms.json",
      JSON.stringify({
        to: "+33600000000",
        message: "moved outbox",
        sentAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const host = alepha.inject(ServerProvider).hostname;
    const res = await fetch(`${host}/__devtools/api/sms`);
    const body = (await res.json()) as {
      messages: Array<{ to: string; message: string }>;
      directory: string;
    };

    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].message).toBe("moved outbox");
    // And it says where it looked, so the view can stop printing the default
    // path as a literal.
    expect(body.directory).toBe("/data/sms");

    await alepha.stop();
  });

  it("reads email from the configured directory too", async ({ expect }) => {
    const { alepha, fs } = await boot({
      emails: "/data/emails",
      sms: "/data/sms",
    });

    await fs.mkdir("/data/emails", { recursive: true });
    await fs.writeFile(
      "/data/emails/someone,2026-01-01T00-00-00-000Z.eml.json",
      JSON.stringify({
        to: "someone@example.com",
        subject: "moved outbox",
        body: "hello",
        sentAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const host = alepha.inject(ServerProvider).hostname;
    const res = await fetch(`${host}/__devtools/api/emails`);
    const body = (await res.json()) as {
      emails: Array<{ subject: string }>;
      directory: string;
    };

    expect(body.emails).toHaveLength(1);
    expect(body.emails[0].subject).toBe("moved outbox");
    expect(body.directory).toBe("/data/emails");

    await alepha.stop();
  });
});
