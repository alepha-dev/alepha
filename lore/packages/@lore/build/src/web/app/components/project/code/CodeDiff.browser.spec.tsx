import { virtualClientFake } from "@lore/core/testing";
import { I18n } from "@lore/core/web";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import CodeDiff from "./CodeDiff.tsx";

/**
 * The unified diff (#Q4135): hunks highlighted with their numbers and
 * anchors, the context between two hunks loaded on demand, a collapsed
 * generated file loaded when opened, and the two slots #E169 fills.
 */
const NEW = "b".repeat(40);
const calls: Array<[string, unknown]> = [];

class FakeLinkProvider extends LinkProvider {
  override client(): any {
    return virtualClientFake({
      getCodeBlobLines: async (input: unknown) => {
        calls.push(["lines", input]);
        return { lines: ["four", "five"] };
      },
      getCodeDiffFile: async (input: unknown) => {
        calls.push(["file", input]);
        return {
          path: "yarn.lock",
          kind: "modified",
          generated: true,
          submodule: false,
          status: "loaded",
          additions: 1,
          deletions: 1,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: [
                {
                  kind: "del",
                  oldLine: 1,
                  text: "lock 1",
                  anchor: "yarn.lock:old:1",
                },
                {
                  kind: "add",
                  newLine: 1,
                  text: "lock 2",
                  anchor: "yarn.lock:new:1",
                },
              ],
            },
          ],
        };
      },
    });
  }
}

describe("CodeDiff", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    calls.length = 0;
    await alepha?.stop();
    alepha = undefined;
  });

  it("draws hunks with anchors and slots, expands context, loads a collapsed file", async ({
    expect,
  }) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    const anchors: string[] = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <CodeDiff
          projectId={7}
          repoSlug="api"
          from={"a".repeat(40)}
          to={NEW}
          diff={{
            from: "a".repeat(40),
            to: NEW,
            total: 2,
            page: 0,
            pageSize: 50,
            partial: false,
            files: [
              {
                path: "src/a.ts",
                kind: "modified",
                newSha: NEW,
                oldSha: "c".repeat(40),
                generated: false,
                submodule: false,
                status: "loaded",
                additions: 1,
                deletions: 1,
                newLineCount: 8,
                hunks: [
                  {
                    oldStart: 6,
                    oldLines: 2,
                    newStart: 6,
                    newLines: 2,
                    lines: [
                      {
                        kind: "del",
                        oldLine: 6,
                        text: "const a = 1;",
                        anchor: "src/a.ts:old:6",
                      },
                      {
                        kind: "add",
                        newLine: 6,
                        text: "const a = 2;",
                        anchor: "src/a.ts:new:6",
                      },
                      {
                        kind: "context",
                        oldLine: 7,
                        newLine: 7,
                        text: "export {};",
                        anchor: "src/a.ts:new:7",
                      },
                    ],
                  },
                ],
              },
              {
                path: "yarn.lock",
                kind: "modified",
                generated: true,
                submodule: false,
                status: "collapsed",
              },
            ],
          }}
          renderLineAfter={(anchor) => {
            anchors.push(anchor);
            return anchor === "src/a.ts:new:6" ? (
              <span>thread here</span>
            ) : null;
          }}
          renderFileHeaderActions={(file) => <span>{`act ${file.path}`}</span>}
        />
      </AlephaContext.Provider>,
    );

    const [first, lock] = screen.getAllByTestId("code-diff-file");
    const rows = first!.querySelectorAll("tr[data-kind]");
    expect([...rows].map((row) => row.getAttribute("data-kind"))).toEqual([
      "del",
      "add",
      "context",
    ]);
    expect(rows[0]?.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(rows[1]?.id).toBe("diff-src/a.ts:new:6");
    expect(screen.getByText("thread here")).toBeTruthy();
    expect(anchors).toContain("src/a.ts:old:6");
    expect(screen.getByText("act src/a.ts")).toBeTruthy();
    expect(screen.getByText("act yarn.lock")).toBeTruthy();

    // Lines 1 to 5 hide before the hunk, 8 after it.
    fireEvent.click(screen.getByText("Show 5 hidden lines"));
    expect(await screen.findByText("four")).toBeTruthy();
    expect(calls[0]).toEqual([
      "lines",
      {
        params: { projectId: 7, slug: "api", sha: NEW },
        query: { start: 1, end: 5 },
      },
    ]);

    // The lockfile is collapsed: nothing asked until it is opened.
    expect(calls.filter(([kind]) => kind === "file")).toHaveLength(0);
    fireEvent.click(lock!.querySelector("button")!);
    expect(await screen.findByText("lock 2")).toBeTruthy();
    expect(calls.find(([kind]) => kind === "file")?.[1]).toMatchObject({
      query: { path: "yarn.lock", to: NEW },
    });
  });
});
