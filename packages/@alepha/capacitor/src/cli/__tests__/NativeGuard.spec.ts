import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { NativeGuard } from "../services/NativeGuard.ts";
import { seedNativeProject } from "./memoryProject.ts";

const ROOT = "/app";

const setup = async () => {
  const alepha = Alepha.create().with({
    provide: FileSystemProvider,
    use: MemoryFileSystemProvider,
  });
  const fs = alepha.inject(MemoryFileSystemProvider);
  await seedNativeProject(fs, ROOT);
  return { fs, guard: alepha.inject(NativeGuard) };
};

describe("NativeGuard", () => {
  it("finds nothing in a project as init leaves it", async ({ expect }) => {
    const { guard } = await setup();

    expect(await guard.inspect(ROOT, ["ios", "android"])).toEqual([]);
  });

  it("finds server.url in either copied capacitor.config.json", async ({
    expect,
  }) => {
    const { fs, guard } = await setup();
    const residue = JSON.stringify({
      appId: "dev.alepha.mobile",
      server: { url: "http://192.168.1.2:5173", cleartext: true },
    });
    await fs.writeFile(`${ROOT}/ios/App/App/capacitor.config.json`, residue);
    await fs.writeFile(
      `${ROOT}/android/app/src/main/assets/capacitor.config.json`,
      residue,
    );

    const findings = await guard.inspect(ROOT, ["ios", "android"]);

    expect(findings.filter((f) => f.includes("192.168.1.2"))).toHaveLength(2);
    expect(findings.filter((f) => f.includes("cleartext"))).toHaveLength(2);
  });

  it("finds server.url in capacitor.config.ts", async ({ expect }) => {
    const { fs, guard } = await setup();
    await fs.writeFile(
      `${ROOT}/capacitor.config.ts`,
      'const config = {\n  appId: "x",\n  server: {\n    url: "http://localhost:5173",\n  },\n};',
    );

    expect(await guard.inspect(ROOT, [])).toEqual([
      expect.stringContaining("capacitor.config.ts sets server.url"),
    ]);
  });

  it("finds App Transport Security exceptions", async ({ expect }) => {
    const { fs, guard } = await setup();
    const plist = (
      fs.getFileContent(`${ROOT}/ios/App/App/Info.plist`) ?? ""
    ).replace(
      "<dict>\n",
      "<dict>\n\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>\n\t\t<key>NSExceptionDomains</key>\n\t\t<dict/>\n\t</dict>\n",
    );
    await fs.writeFile(`${ROOT}/ios/App/App/Info.plist`, plist);

    const findings = await guard.inspect(ROOT, ["ios"]);

    expect(findings).toHaveLength(2);
  });

  it("finds cleartext and user CAs outside debug-overrides, and allows them inside", async ({
    expect,
  }) => {
    const { fs, guard } = await setup();
    const nsc = `${ROOT}/android/app/src/main/res/xml/network_security_config.xml`;
    await fs.writeFile(
      nsc,
      '<network-security-config><debug-overrides><trust-anchors><certificates src="user"/></trust-anchors></debug-overrides></network-security-config>',
    );
    expect(await guard.inspect(ROOT, ["android"])).toEqual([]);

    await fs.writeFile(
      nsc,
      '<network-security-config><base-config cleartextTrafficPermitted="true"><trust-anchors><certificates src="user"/></trust-anchors></base-config></network-security-config>',
    );
    expect(await guard.inspect(ROOT, ["android"])).toHaveLength(2);
  });

  it("finds usesCleartextTraffic in the manifest", async ({ expect }) => {
    const { fs, guard } = await setup();
    const path = `${ROOT}/android/app/src/main/AndroidManifest.xml`;
    await fs.writeFile(
      path,
      (fs.getFileContent(path) ?? "").replace(
        "<application",
        '<application android:usesCleartextTraffic="true"',
      ),
    );

    expect(await guard.inspect(ROOT, ["android"])).toHaveLength(1);
  });

  it("refuses a copied config it cannot read", async ({ expect }) => {
    const { fs, guard } = await setup();
    await fs.writeFile(`${ROOT}/ios/App/App/capacitor.config.json`, "{ nope");

    await expect(guard.inspect(ROOT, ["ios"])).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("does not mind a platform that does not exist", async ({ expect }) => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });

    expect(
      await alepha.inject(NativeGuard).inspect("/empty", ["ios", "android"]),
    ).toEqual([]);
  });
});
