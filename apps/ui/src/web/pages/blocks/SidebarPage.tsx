import { Badge } from "@alepha/ui/components/ui/badge";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";

/**
 * The sidebar is the one component that cannot be previewed in a box: it is
 * already on screen, and a second `SidebarProvider` would fight the first for
 * the collapse state. So this page documents the shape `AppShell` takes as
 * `nav`, and points at the live one to the left.
 */
const SidebarPage = () => (
  <BlockPage
    title="Sidebar"
    description="The navigation tree. The live one is on the left."
  >
    <Specimen title="A leaf">
      <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
        {`{ href: "/blocks/table", label: "AlephaTable", icon: Table2, active }`}
      </pre>
      <p className="text-sm">
        <code className="bg-muted rounded px-1">icon</code> takes either a
        component (instantiated with the row's sizing) or an already-rendered
        node, so nav metadata declared on a <code>$page</code> can carry its
        own.
      </p>
    </Specimen>

    <Specimen title="A collapsible group">
      <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
        {`{
  label: "Forms",
  icon: SlidersHorizontal,
  defaultOpen: true,
  children: [
    { href: "/blocks/controls", label: "Controls" },
    { href: "/blocks/select", label: "Select" },
  ],
}`}
      </pre>
      <p className="text-sm">
        An item with <code className="bg-muted rounded px-1">children</code>{" "}
        becomes a toggle and its own <code>href</code> is ignored, so a parent
        is never a destination. <code>defaultOpen</code> falls back to whether
        any descendant is active, which is what stops a deep link landing inside
        a collapsed group.
      </p>
    </Specimen>

    <Specimen title="Badges and collapse" inline>
      <Badge variant="tint" tone="info">
        badge
      </Badge>
      <span className="text-sm">
        A trailing <code className="bg-muted rounded px-1">badge</code> is
        hidden once the sidebar collapses to icons. Collapse it with the button
        at the top of the sidebar.
      </span>
    </Specimen>

    <Specimen title="Groups">
      <p className="text-sm">
        <code className="bg-muted rounded px-1">NavGroup</code> is a label and
        its items. The groups on the left are Overview, Blocks, Auth and Admin;
        a group renders its label as a heading and never collapses, which is
        what keeps the top level scannable while the long lists inside it fold
        away.
      </p>
    </Specimen>
  </BlockPage>
);

export default SidebarPage;
