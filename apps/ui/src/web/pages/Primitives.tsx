import { Badge } from "@alepha/ui/components/ui/badge";

import { BlockPage } from "@/web/components/BlockPage.tsx";

/**
 * The 43 files in `@alepha/ui/components/ui`, listed rather than documented.
 *
 * Deliberately an inventory and not a catalogue. These are stock shadcn
 * primitives, refreshed wholesale by `yarn w @alepha/ui sync` from the public
 * base-nova registry, so hand-written variant pages here would document code
 * this repository does not own and that `sync` can change underneath them. What
 * is genuinely ours - the blocks built on top - gets real pages instead.
 */
const PRIMITIVES = [
  "alert-dialog",
  "alert",
  "avatar",
  "badge",
  "breadcrumb",
  "button-group",
  "button",
  "calendar",
  "card",
  "chart",
  "checkbox",
  "combobox",
  "command",
  "context-menu",
  "dialog",
  "drawer",
  "dropdown-menu",
  "empty",
  "hover-card",
  "input-group",
  "input-otp",
  "input",
  "kbd",
  "label",
  "menubar",
  "pagination",
  "popover",
  "progress",
  "resizable",
  "segmented",
  "select",
  "separator",
  "sheet",
  "sidebar",
  "skeleton",
  "slider",
  "sonner",
  "spinner",
  "switch",
  "table",
  "tabs",
  "textarea",
  "tooltip",
];

const Primitives = () => (
  <BlockPage
    title="Primitives"
    source="@alepha/ui/components/ui/*"
    description="The stock shadcn primitives @alepha/ui re-exports, unmodified. They are refreshed from the public base-nova registry, so their documentation lives upstream rather than here."
  >
    <div className="flex flex-wrap gap-2">
      {PRIMITIVES.map((name) => (
        <a
          key={name}
          href={`https://ui.shadcn.com/docs/components/${name}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          <Badge
            variant="outline"
            className="hover:border-primary/60 font-mono text-xs"
          >
            {name}
          </Badge>
        </a>
      ))}
    </div>
    <p className="text-muted-foreground text-xs">
      {PRIMITIVES.length} primitives. Each links to its upstream documentation.
      A few are wrapped or extended by the blocks in the sidebar, which is where
      the Alepha-specific behaviour is shown.
    </p>
  </BlockPage>
);

export default Primitives;
