import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { capacitorOptions } from "../atoms/capacitorOptions.ts";
import { NativeGuard } from "../services/NativeGuard.ts";
import { seedNativeProject } from "./memoryProject.ts";

const ROOT = "/app";
const MANIFEST = `${ROOT}/android/app/src/main/AndroidManifest.xml`;
const PLIST = `${ROOT}/ios/App/App/Info.plist`;
const RES_XML = `${ROOT}/android/app/src/main/res/xml`;
const CLEARTEXT =
  '<network-security-config><base-config cleartextTrafficPermitted="true"/></network-security-config>';

const setup = async (options?: { iosLocalNetworking: boolean }) => {
  const alepha = Alepha.create().with({
    provide: FileSystemProvider,
    use: MemoryFileSystemProvider,
  });
  if (options) {
    alepha.store.set(capacitorOptions, {
      appId: "dev.alepha.mobile",
      appName: "Mobile",
      scheme: "mobile",
      ...options,
    });
  }
  const fs = alepha.inject(MemoryFileSystemProvider);
  await seedNativeProject(fs, ROOT);
  return { fs, guard: alepha.inject(NativeGuard) };
};

const setApplicationAttribute = async (
  fs: MemoryFileSystemProvider,
  attribute: string,
) => {
  await fs.writeFile(
    MANIFEST,
    (fs.getFileContent(MANIFEST) ?? "").replace(
      "<application",
      `<application ${attribute}`,
    ),
  );
};

const setTransportSecurity = async (
  fs: MemoryFileSystemProvider,
  keys: string,
) => {
  await fs.writeFile(
    PLIST,
    (fs.getFileContent(PLIST) ?? "").replace(
      "<dict>\n",
      `<dict>\n\t<key>NSAppTransportSecurity</key>\n\t<dict>\n${keys}\n\t</dict>\n`,
    ),
  );
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
    await setTransportSecurity(
      fs,
      "\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>\n\t\t<key>NSExceptionDomains</key>\n\t\t<dict/>",
    );

    const findings = await guard.inspect(ROOT, ["ios"]);

    expect(findings).toHaveLength(2);
  });

  it("finds NSAllowsLocalNetworking, naming the way to keep it", async ({
    expect,
  }) => {
    const { fs, guard } = await setup();
    await setTransportSecurity(
      fs,
      "\t\t<key>NSAllowsLocalNetworking</key>\n\t\t<true/>",
    );

    expect(await guard.inspect(ROOT, ["ios"])).toEqual([
      expect.stringContaining("capacitor({ iosLocalNetworking: true })"),
    ]);
  });

  it("leaves NSAllowsLocalNetworking set to false alone", async ({
    expect,
  }) => {
    const { fs, guard } = await setup();
    await setTransportSecurity(
      fs,
      "\t\t<key>NSAllowsLocalNetworking</key>\n\t\t<false/>",
    );

    expect(await guard.inspect(ROOT, ["ios"])).toEqual([]);
  });

  it("lets a declared NSAllowsLocalNetworking through, and only that key", async ({
    expect,
  }) => {
    const { fs, guard } = await setup({ iosLocalNetworking: true });
    await setTransportSecurity(
      fs,
      "\t\t<key>NSAllowsLocalNetworking</key>\n\t\t<true/>\n\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>",
    );

    expect(await guard.inspect(ROOT, ["ios"])).toEqual([
      expect.stringContaining("NSAllowsArbitraryLoads"),
    ]);
  });

  it("finds cleartext and user CAs outside debug-overrides, and allows them inside", async ({
    expect,
  }) => {
    const { fs, guard } = await setup();
    await setApplicationAttribute(
      fs,
      'android:networkSecurityConfig="@xml/network_security_config"',
    );
    const nsc = `${RES_XML}/network_security_config.xml`;
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

  it("reads the network security config under the name the manifest gives it", async ({
    expect,
  }) => {
    const { fs, guard } = await setup();
    await setApplicationAttribute(
      fs,
      'android:networkSecurityConfig="@xml/net_rules"',
    );
    await fs.writeFile(`${RES_XML}/net_rules.xml`, CLEARTEXT);

    expect(await guard.inspect(ROOT, ["android"])).toEqual([
      expect.stringMatching(/^android\/.*\/net_rules\.xml permits cleartext/),
    ]);
  });

  it("reads the name however the manifest quotes it", async ({ expect }) => {
    const { fs, guard } = await setup();
    await setApplicationAttribute(
      fs,
      "android:networkSecurityConfig = '@xml/net_rules'",
    );
    await fs.writeFile(`${RES_XML}/net_rules.xml`, CLEARTEXT);

    expect(await guard.inspect(ROOT, ["android"])).toHaveLength(1);
  });

  it("takes the name from the attribute, not from a comment above it", async ({
    expect,
  }) => {
    const { fs, guard } = await setup();
    await setApplicationAttribute(
      fs,
      'android:networkSecurityConfig="@xml/net_rules"',
    );
    await fs.writeFile(
      MANIFEST,
      `<!-- android:networkSecurityConfig="@xml/old_rules" -->\n${fs.getFileContent(MANIFEST)}`,
    );
    await fs.writeFile(`${RES_XML}/net_rules.xml`, CLEARTEXT);

    expect(await guard.inspect(ROOT, ["android"])).toHaveLength(1);
  });

  it("ignores a network security config the manifest does not name", async ({
    expect,
  }) => {
    // Android never reads it, so it cannot ship anything.
    const { fs, guard } = await setup();
    await fs.writeFile(`${RES_XML}/network_security_config.xml`, CLEARTEXT);

    expect(await guard.inspect(ROOT, ["android"])).toEqual([]);
  });

  it("finds usesCleartextTraffic in the manifest", async ({ expect }) => {
    const { fs, guard } = await setup();
    await setApplicationAttribute(fs, 'android:usesCleartextTraffic="true"');

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
