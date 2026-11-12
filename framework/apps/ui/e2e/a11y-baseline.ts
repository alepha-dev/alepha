/**
 * The token sets every showcase page is scanned in. `cvd` is not a theme: it
 * is the colour-blind vision mode, a class on `<html>` that remaps the signal
 * tokens, and it combines with `.dark`.
 */
export type A11yMode = "light" | "dark" | "light-cvd" | "dark-cvd";

/**
 * One known accessibility finding of the showcase scan (`a11y.spec.ts`).
 *
 * A finding is one (page, mode, rule, node). It is known when an entry has
 * the same `page`, `rule` and `selector` and lists that mode.
 */
export interface A11yBaselineEntry {
  /**
   * The route path, `/blocks/buttons`. For a state opened by a click, the path
   * plus the state's name as the spec names it: `/blocks/dialog#confirm`.
   */
  page: string;

  /**
   * The token sets the finding was seen in.
   */
  modes: A11yMode[];

  /**
   * The axe rule id, `color-contrast`.
   */
  rule: string;

  /**
   * axe's own selector for the node, copied from the failure message.
   */
  selector: string;

  /**
   * One sentence saying why it is not fixed here, and the quest that tracks
   * the fix when there is one.
   */
  reason: string;
}

/**
 * Every known finding of the showcase scan.
 *
 * ⚠️ Edited by hand only. A finding outside this list fails the run, and the
 * failure prints it in the shape of an entry: baselining it is a deliberate
 * copy with a reason written by hand. An entry, or one of its modes, that no
 * finding matches any more fails the run too, so a fix lands by deleting its
 * entry. There is no wildcard: every entry names one page, one rule and one
 * selector.
 */
export const A11Y_BASELINE: A11yBaselineEntry[] = [
  // ── color-contrast ──
  {
    page: "/admin/jobs/:jobName",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: ".-mt-2.justify-between.rounded-t-none > .gap-2 > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/admin/jobs/:jobName",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: 'span[data-tone="neutral"]',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/admin/users/:userId",
    modes: ["dark", "dark-cvd"],
    rule: "color-contrast",
    selector: ".hover\\:underline",
    reason:
      "text-primary on the card background is under 4.5:1 in dark mode; the fix is a --primary token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/buttons#palette",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      "#base-ui-_r_1_-0 > .flex-1.flex-col.min-w-0 > .truncate.text-xs.text-muted-foreground",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/buttons#palette",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: ".gap-1\\.5.items-center.flex:nth-child(3) > kbd",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/data-table/addons",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      '.hover\\:bg-\\[color-mix\\(in_oklab\\,var\\(--muted\\)\\,transparent_40\\%\\)\\].rounded-t-\\[0\\.625rem\\][role="tab"]:nth-child(2) > .rounded-full.px-1\\.5.tabular-nums',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/data-table/addons",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".justify-between.shadow-\\[inset_0_1px_0_0_var\\(--bevel\\)\\].-mt-2 > .gap-2 > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/data-table/addons",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: ".rounded-t-md > .truncate",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/data-table/basic",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".-mt-2.rounded-t-none.shadow-\\[inset_0_1px_0_0_var\\(--bevel\\)\\] > .gap-2 > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/permission-matrix",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".h-auto.min-w-36:nth-child(2) > .gap-1.flex-col > .font-normal.text-xs.text-muted-foreground",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/permission-matrix",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".h-auto.min-w-36:nth-child(3) > .gap-1.flex-col > .font-normal.text-xs.text-muted-foreground",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/permission-matrix",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".h-auto.min-w-36:nth-child(4) > .gap-1.flex-col > .font-normal.text-xs.text-muted-foreground",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/permission-matrix",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".h-auto.min-w-36:nth-child(5) > .gap-1.flex-col > .font-normal.text-xs.text-muted-foreground",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/permission-matrix",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".hover\\:bg-transparent:nth-child(1) > .py-1\\.5.tracking-wide.uppercase > .gap-2",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/permission-matrix",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".hover\\:bg-transparent:nth-child(5) > .py-1\\.5.tracking-wide.uppercase > .gap-2",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/permission-matrix",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".hover\\:bg-transparent:nth-child(9) > .py-1\\.5.tracking-wide.uppercase > .gap-2",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/plate",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: 'a[href="/blocks/plate?tab=artifacts"]',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/plate",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: 'a[href="/blocks/plate?tab=changelog"]',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/plate",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: 'a[href="/blocks/plate?tab=contents"]',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/plate",
    modes: ["light", "dark", "light-cvd", "dark-cvd"],
    rule: "color-contrast",
    selector:
      'a[href="/blocks/plate?tab=contents"] > .bg-foreground\\/10.h-\\[18px\\].min-w-\\[18px\\]',
    reason:
      "The plate tab count, --muted-foreground on bg-foreground/10: 3.52:1 light, 4.33:1 dark; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/plate",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: 'a[href="/blocks/plate?tab=flow"]',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/shell",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: ".size-7.bg-muted.text-xs",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/shell",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: "p:nth-child(3) > code",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/sidebar",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: "p:nth-child(3) > code:nth-child(1)",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/sidebar",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: "p:nth-child(3) > code:nth-child(2)",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/sidebar",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: "p:nth-child(5) > code:nth-child(1)",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/blocks/sidebar",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: "p:nth-child(5) > code:nth-child(2)",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/account/connections",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: ".-mt-2.flex-wrap.rounded-t-none > div > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/account/keys",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".-mt-2.rounded-t-none.shadow-\\[inset_0_1px_0_0_var\\(--bevel\\)\\] > .gap-2 > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/account/sessions",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: ".-mt-2.flex-wrap.rounded-t-none > div > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/files",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: ".rounded-t-md > .truncate",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/jobs",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".-mt-2.rounded-t-none.shadow-\\[inset_0_1px_0_0_var\\(--bevel\\)\\] > div > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/keys",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".-mt-2.rounded-t-none.shadow-\\[inset_0_1px_0_0_var\\(--bevel\\)\\] > div > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/notifications",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".-mt-2.rounded-t-none.shadow-\\[inset_0_1px_0_0_var\\(--bevel\\)\\] > div > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/notifications",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: 'span[data-tone="neutral"]',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/payments",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: ".-mt-2.flex-wrap.rounded-t-none > div > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/payments",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      'tr:nth-child(5) > td:nth-child(5) > .border-border.bg-muted[data-tone="neutral"]',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/payments",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      'tr:nth-child(6) > td:nth-child(5) > .border-border.bg-muted[data-tone="neutral"]',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/payments",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      'tr:nth-child(8) > td:nth-child(5) > .border-border.bg-muted[data-tone="neutral"]',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/payments",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      'tr:nth-child(9) > td:nth-child(5) > .border-border.bg-muted[data-tone="neutral"]',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/sessions",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".-mt-2.rounded-t-none.shadow-\\[inset_0_1px_0_0_var\\(--bevel\\)\\] > div > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/webhooks",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".-mt-2.rounded-t-none.shadow-\\[inset_0_1px_0_0_var\\(--bevel\\)\\] > div > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/organizations/invitations",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: ".-mt-2.flex-wrap.rounded-t-none > div > p",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/organizations/members",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: ".flex-1.flex-col.min-w-0 > .text-xs.text-muted-foreground",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/organizations/members",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector: 'span[title="Oct 10, 2026 12:00 PM"]',
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/organizations/ranks",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".h-auto.min-w-36:nth-child(2) > .gap-1.flex-col > .font-normal.text-xs.text-muted-foreground",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/organizations/ranks",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".h-auto.min-w-36:nth-child(3) > .gap-1.flex-col > .font-normal.text-xs.text-muted-foreground",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/organizations/ranks",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".h-auto.min-w-36:nth-child(4) > .gap-1.flex-col > .font-normal.text-xs.text-muted-foreground",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/organizations/ranks",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".hover\\:bg-transparent:nth-child(1) > .py-1\\.5.tracking-wide.uppercase > .gap-2",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/organizations/ranks",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".hover\\:bg-transparent:nth-child(4) > .py-1\\.5.tracking-wide.uppercase > .gap-2",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/organizations/ranks",
    modes: ["light", "light-cvd"],
    rule: "color-contrast",
    selector:
      ".hover\\:bg-transparent:nth-child(8) > .py-1\\.5.tracking-wide.uppercase > .gap-2",
    reason:
      "--muted-foreground (#737373) on --muted (#f5f5f5) is 4.34:1 in light mode; the fix is a token change, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  // ── target-size ──
  {
    page: "/pages/admin/files",
    modes: ["light", "dark", "light-cvd", "dark-cvd"],
    rule: "target-size",
    selector: "#base-ui-_r_1m_",
    reason:
      "A small bucket of the storage bar draws a 12x10 px button; a 24x24 px target needs a layout change of the usage bar, outside #E135's fix budget (gap recorded on #Q3349).",
  },
  {
    page: "/pages/admin/files",
    modes: ["light", "dark", "light-cvd", "dark-cvd"],
    rule: "target-size",
    selector: "#base-ui-_r_1o_",
    reason:
      "A small bucket of the storage bar draws a 12x10 px button; a 24x24 px target needs a layout change of the usage bar, outside #E135's fix budget (gap recorded on #Q3349).",
  },
];
