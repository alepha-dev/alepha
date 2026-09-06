import { z } from "alepha";
import type { ReactElement, ReactNode } from "react";

import { Showcase } from "@/web/components/Showcase.tsx";
import { TreeDragSpecimen } from "@/web/pages/blocks/TreeDragSpecimen.tsx";
import { TreeEditorSpecimen } from "@/web/pages/blocks/TreeEditorSpecimen.tsx";
import { TreeNavSpecimen } from "@/web/pages/blocks/TreeNavSpecimen.tsx";

/**
 * The knobs drive the third specimen, which is the only one with capabilities
 * to turn off; the first two ARE their tier and would stop being specimens if
 * they could be reconfigured into each other.
 *
 * `depth` is the exception and feeds all three, because the indent guides are
 * the detail most likely to regress and the hardest to see at depth 1.
 */
const KNOBS = z.object({
  depth: z
    .enum(["1", "2", "3", "4"])
    .default("2")
    .meta({ title: "Nesting depth" }),
  draggable: z.boolean().default(true).meta({ title: "Drag and drop" }),
  renamable: z.boolean().default(true).meta({ title: "Inline rename" }),
  menu: z.boolean().default(true).meta({ title: "Context menu" }),
});

/**
 * Three specimens, one per capability tier.
 *
 * Not decoration. This is the only place the component can be DRIVEN without
 * an application's auth, database and router behind it, which is what
 * `apps/ui/e2e/tree.spec.ts` needs and what makes a regression visible in a
 * second rather than by opening Lore.
 */
const Tree = (): ReactElement => (
  <Showcase
    id="blocks/Tree"
    title="Tree"
    description="One tree, three capability tiers."
    // A tree in a 200px box proves nothing about a tree in a pane.
    fill
    schema={KNOBS}
    initialValues={{
      depth: "2",
      draggable: true,
      renamable: true,
      menu: true,
    }}
  >
    {(v) => (
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-1">
        <TreeSection
          heading="Read only"
          description="Rows, icons, selection and disclosure. Five props, no hook, and not a byte of drag handler."
        >
          <TreeNavSpecimen depth={Number(v.depth)} />
        </TreeSection>

        <TreeSection
          heading="Drag and drop"
          description="The 28/44/28 zones, the drop markers, and a branch dropped into its own subtree refused."
        >
          <TreeDragSpecimen depth={Number(v.depth)} />
        </TreeSection>

        <TreeSection
          heading="Full editor"
          description="Inline rename, a context menu of your own verbs, the pane resizer and a trailing badge."
        >
          <TreeEditorSpecimen
            depth={Number(v.depth)}
            draggable={v.draggable}
            renamable={v.renamable}
            menu={v.menu}
          />
        </TreeSection>
      </div>
    )}
  </Showcase>
);

interface TreeSectionProps {
  heading: string;
  description: string;
  children: ReactNode;
}

const TreeSection = (props: TreeSectionProps): ReactElement => (
  // ⚠️ `shrink-0`, and it is load-bearing. The page is a flex COLUMN with its
  // own scroller, so without it the three sections are squeezed to share one
  // viewport height and each tree's rows spill out of its own box and over the
  // next heading. Each section takes its natural height and the page scrolls.
  <section className="flex shrink-0 flex-col gap-2">
    <div>
      <h2 className="text-sm font-medium">{props.heading}</h2>
      <p className="text-muted-foreground text-xs">{props.description}</p>
    </div>
    <div className="border-border bg-background flex rounded-md border py-1">
      {props.children}
    </div>
  </section>
);

export default Tree;
