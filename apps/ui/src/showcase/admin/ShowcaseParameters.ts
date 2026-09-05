import type {
  ParameterCurrentResponse,
  ParameterResponse,
  ParameterTreeNode,
} from "alepha/api/parameters";

/**
 * A fake parameter tree, its current values and their version history.
 *
 * ⚠️ **A parameter's content is always an OBJECT, never a scalar.** `z.json()`
 * is `record(string, any)`, so one `$parameter` holds a GROUP of related
 * settings, the way `lore.campaign.limits` holds four caps. A fixture storing
 * `25` under a name rejects the whole response with "expected record, received
 * number", which is how this was found.
 *
 * ⚠️ The tree, the values and the history are all derived from one `SETTINGS`
 * list. `AdminParameters` navigates the tree and then asks for the leaf it
 * landed on, so a tree node with no matching value is a dead end: the panel
 * opens empty and reports nothing.
 */
export class ShowcaseParameters {
  /**
   * `origin` matters: an `orphan` is a saved parameter nothing declares any
   * more, which a rename or a removal leaves behind. The tree renders it
   * differently and never deletes it on its own, so having one is the only way
   * to see that state.
   */
  protected static readonly SETTINGS: [
    string,
    Record<string, unknown>,
    string,
    string,
  ][] = [
    [
      "app.branding",
      { title: "Alepha UI", accent: "#b85434", showBadge: true },
      "both",
      "How the shell presents itself.",
    ],
    [
      "app.limits",
      { maxUploadMb: 25, rateWindowSec: 60, maxBatchSize: 20 },
      "both",
      "Soft caps applied per request. Bump without a redeploy.",
    ],
    [
      "app.features",
      { betaSearch: true, inlineDiff: false },
      "registered",
      "Feature switches, declared but never overridden here.",
    ],
    [
      "app.legacyExport",
      { enabled: false, format: "csv" },
      "orphan",
      "Rows exist and no $parameter declares this any more.",
    ],
    [
      "mail.sender",
      { fromName: "Alepha", replyTo: "noreply@alepha.dev" },
      "both",
      "Identity on outgoing mail.",
    ],
  ];

  public tree(): ParameterTreeNode[] {
    const root: ParameterTreeNode[] = [];

    for (const [path, , origin] of ShowcaseParameters.SETTINGS) {
      const parts = path.split(".");
      let level = root;
      for (let i = 0; i < parts.length; i++) {
        const isLeaf = i === parts.length - 1;
        const soFar = parts.slice(0, i + 1).join(".");
        let node = level.find((n) => n.name === parts[i]);
        if (!node) {
          node = {
            name: parts[i],
            path: soFar,
            isLeaf,
            origin: origin as ParameterTreeNode["origin"],
            children: [],
          };
          level.push(node);
        }
        // A folder carries the origin its leaves agree on, and `both` when
        // they disagree, so a whole retired branch reads as one orphan.
        if (!isLeaf && node.origin !== origin) {
          node.origin = "both";
        }
        level = node.children as ParameterTreeNode[];
      }
    }

    return root;
  }

  public current(name: string): ParameterCurrentResponse {
    const setting = ShowcaseParameters.SETTINGS.find(([p]) => p === name);
    if (!setting) {
      return {} as ParameterCurrentResponse;
    }
    const [path, value, , description] = setting;
    const versions = this.history(path);

    return {
      current: versions.find((v) => v.status === "current"),
      next: versions.find((v) => v.status === "future"),
      defaultValue: value,
      currentValue: value,
      schema: undefined,
      description,
    } as ParameterCurrentResponse;
  }

  /**
   * Three versions per parameter: expired, current and scheduled. That gives
   * the history panel a row per status it draws differently, and gives the
   * diff view two adjacent versions to compare.
   */
  public history(name: string): ParameterResponse[] {
    const setting = ShowcaseParameters.SETTINGS.find(([p]) => p === name);
    if (!setting) return [];
    const [path, value] = setting;

    // The previous version differs in exactly one key, so the diff view has
    // something small and legible to show rather than a wholesale rewrite.
    const [firstKey] = Object.keys(value);
    const previous = { ...value };
    const was = previous[firstKey];
    previous[firstKey] =
      typeof was === "number"
        ? was - 5
        : typeof was === "boolean"
          ? !was
          : `${String(was)} (old)`;

    return [
      this.version(path, 3, value, "future", -168, "Scheduled for next week"),
      this.version(path, 2, value, "current", 72, "Raised after the incident"),
      this.version(path, 1, previous, "expired", 720, "Initial value"),
    ];
  }

  protected version(
    name: string,
    version: number,
    content: Record<string, unknown>,
    status: string,
    hoursAgo: number,
    changeDescription: string,
  ): ParameterResponse {
    return {
      id: `00000000-0000-4000-e000-${String(version).padStart(12, "0")}`,
      createdAt: this.at(hoursAgo),
      updatedAt: this.at(hoursAgo),
      organizationId: undefined,
      name,
      content,
      schemaHash: "sha256:showcase",
      activationDate: this.at(hoursAgo),
      version,
      changeDescription,
      tags: undefined,
      creatorId: "00000000-0000-4000-8000-000000000001",
      creatorName: "Ada Lovelace",
      previousContent: undefined,
      migrationLog: undefined,
      status,
      creator: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "ada@alepha.dev",
      },
    } as unknown as ParameterResponse;
  }

  protected at(hoursAgo: number): string {
    return new Date(
      Date.UTC(2026, 8, 5, 9, 0) - hoursAgo * 3_600_000,
    ).toISOString();
  }
}
