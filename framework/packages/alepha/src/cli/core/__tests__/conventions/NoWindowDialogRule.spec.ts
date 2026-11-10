import { describe, expect, it } from "vitest";

import { ConventionRunner } from "../../services/ConventionRunner.ts";
import { checkFiles, lines } from "../fixtures/conventionHarness.ts";

const RULE = "no-window-dialog";

const withUi = JSON.stringify({ dependencies: { "@alepha/ui": "^1.0.0" } });

describe("no-window-dialog", () => {
  it("refuses window.confirm, alert, prompt and the bare calls", async () => {
    const report = await checkFiles(
      {
        "package.json": withUi,
        "src/web/Page.tsx": [
          'window.confirm("Delete?");',
          'window.alert("Done");',
          'window.prompt("Name?");',
          'confirm("Delete?");',
          'alert("Done");',
          'prompt("Name?");',
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(lines(report)).toEqual([
      [1, RULE],
      [2, RULE],
      [3, RULE],
      [4, RULE],
      [5, RULE],
      [6, RULE],
    ]);
    expect(report.findings[0].fix).toContain("useDialog");
  });

  it("does not report this.window.alert, a member of the class", async () => {
    const report = await checkFiles(
      {
        "package.json": withUi,
        "src/DesktopShell.ts":
          'export class DesktopShell {\n  show() {\n    this.window.alert("hi");\n  }\n}\n',
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("does not report a bare call whose name the file binds", async () => {
    const report = await checkFiles(
      {
        "package.json": withUi,
        "src/web/CompletionDialog.tsx": [
          "export const CompletionDialog = (props: Props) => {",
          "  const confirm = useConfirm();",
          '  return <button onClick={() => confirm("done")} />;',
          "};",
          "",
        ].join("\n"),
        "src/web/Imported.tsx":
          'import { alert } from "./toast.ts";\nalert("x");\n',
        "src/web/Param.tsx":
          'export const run = ({ prompt }: Ctx) => prompt("x");\n',
      },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("applies only where the nearest package.json lists @alepha/ui", async () => {
    const report = await checkFiles(
      {
        "package.json": withUi,
        "apps/api/package.json": JSON.stringify({ dependencies: {} }),
        "apps/api/src/a.ts": 'confirm("x");\n',
        "apps/web/package.json": JSON.stringify({
          devDependencies: { "@alepha/ui": "workspace:*" },
        }),
        "apps/web/src/b.ts": 'confirm("x");\n',
        "src/c.ts": 'confirm("x");\n',
      },
      RULE,
    );
    expect(report.findings.map((f) => f.file)).toEqual([
      "apps/web/src/b.ts",
      "src/c.ts",
    ]);
  });

  it("does not apply without @alepha/ui at all", async () => {
    const report = await checkFiles(
      { "src/a.ts": 'window.confirm("x");\n' },
      RULE,
    );
    expect(report.findings).toEqual([]);
  });

  it("honours an exemption with a reason, and reports one without", async () => {
    const report = await checkFiles(
      {
        "package.json": withUi,
        "src/a.ts": [
          "// alepha-allow no-window-dialog: the unload guard, which only the browser can show",
          'window.confirm("Leave?");',
          "// alepha-allow no-window-dialog",
          'window.confirm("Leave?");',
          "",
        ].join("\n"),
      },
      RULE,
    );
    expect(lines(report)).toEqual([
      [3, ConventionRunner.ENGINE_IDS.noReason],
      [4, RULE],
    ]);
  });
});
