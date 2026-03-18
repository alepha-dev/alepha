import { Alepha } from "alepha";
import { MemoryShellProvider, ShellProvider } from "alepha/system";
import { describe, test } from "vitest";
import { DockerSshService } from "./DockerSshService.ts";

describe("DockerSshService", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create().with({
      provide: ShellProvider,
      use: MemoryShellProvider,
    });
    const ssh = alepha.inject(DockerSshService);
    const shell = alepha.inject(MemoryShellProvider);
    return { ssh, shell };
  };

  test("checkConnection runs ssh echo command", async ({ expect }) => {
    const { ssh, shell } = createTestEnv();
    shell.outputs.set("ssh root@1.2.3.4 echo ok", "ok");

    await ssh.checkConnection("1.2.3.4");

    expect(shell.wasCalled("ssh root@1.2.3.4 echo ok")).toBe(true);
  });

  test("exec runs command on remote host", async ({ expect }) => {
    const { ssh, shell } = createTestEnv();
    shell.outputs.set("ssh root@1.2.3.4 'ls /opt'", "/opt/alepha");

    const result = await ssh.exec("1.2.3.4", "ls /opt");

    expect(shell.wasCalled("ssh root@1.2.3.4 'ls /opt'")).toBe(true);
    expect(result).toBe("/opt/alepha");
  });

  test("upload runs scp command", async ({ expect }) => {
    const { ssh, shell } = createTestEnv();

    await ssh.upload("1.2.3.4", "/local/dist.tar.gz", "/remote/dist.tar.gz");

    expect(
      shell.wasCalled(
        "scp /local/dist.tar.gz root@1.2.3.4:/remote/dist.tar.gz",
      ),
    ).toBe(true);
  });
});
