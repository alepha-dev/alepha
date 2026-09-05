import { Badge } from "@alepha/ui/components/ui/badge";
import { z } from "alepha";
import { useStore } from "alepha/react";
import { useEffect } from "react";

import { BlockPage } from "@/web/components/BlockPage.tsx";
import { Showcase } from "@/web/components/Showcase.tsx";
import { Specimen } from "@/web/components/Specimen.tsx";
import { shellPrefsAtom } from "@/web/shellPrefsAtom.ts";

/**
 * The knobs drive the REAL shell around this page, rather than a copy of it.
 *
 * Nesting an `AppShell` inside the one already wrapping every page would mean
 * two `SidebarProvider`s fighting over the same collapse state, and the preview
 * would not be the thing being documented anyway. Writing to `shellPrefsAtom`
 * means the sidebar and header you are looking at change as you turn a knob.
 */
const KNOBS = z.object({
  variant: z
    .enum(["sidebar", "floating", "inset"])
    .default("floating")
    .meta({ title: "variant" }),
  headerOutside: z.boolean().default(false).meta({ title: "headerOutside" }),
  breadcrumbs: z.boolean().default(true).meta({ title: "breadcrumbs" }),
});

const Shell = () => {
  const [prefs, setPrefs] = useStore(shellPrefsAtom);

  return (
    <BlockPage
      title="App shell"
      description="The frame around every page. The knobs change the real one."
    >
      <Showcase
        title="AppShell"
        description="Turn a knob and the shell around this page changes."
        schema={KNOBS}
        initialValues={prefs}
      >
        {(v) => <ShellSync values={v} apply={setPrefs} />}
      </Showcase>

      <Specimen title="variant">
        <div className="space-y-2 text-sm">
          <p>
            <Badge variant="outline">sidebar</Badge> Sidebar and page sit flush,
            side by side.
          </p>
          <p>
            <Badge variant="outline">floating</Badge> The page owns the
            background; the sidebar is a rounded card on it.
          </p>
          <p>
            <Badge variant="outline">inset</Badge> The sidebar owns the
            background; the page is the rounded card.
          </p>
        </div>
      </Specimen>

      <Specimen title="headerOutside">
        <p className="text-sm">
          Only applies to <Badge variant="outline">inset</Badge>. It lifts the
          header out of the card so it sits on the sidebar background, leaving
          just the page as the card. On the other variants it is ignored, which
          is why the switch above disables itself.
        </p>
      </Specimen>

      <Specimen title="Where the choice is kept">
        <p className="text-sm">
          In a <code className="bg-muted rounded px-1">$atom</code> with{" "}
          <code className="bg-muted rounded px-1">persist: "localStorage"</code>
          , so it survives a reload. Web storage does not exist during SSR, so
          the first paint uses the default and the stored value lands on the
          pass after: reading it during hydration renders a different tree than
          the server sent, and React refuses to patch that up.
        </p>
      </Specimen>
    </BlockPage>
  );
};

/**
 * Pushes the knob values into the shell atom.
 *
 * A component rather than an effect in the parent, because `Showcase` calls its
 * render prop with the current values and that is the only place they exist.
 */
const ShellSync = (props: {
  values: { variant: any; headerOutside: boolean; breadcrumbs: boolean };
  apply: (v: any) => void;
}) => {
  const { values, apply } = props;

  useEffect(() => {
    apply(values);
  }, [values.variant, values.headerOutside, values.breadcrumbs]);

  return (
    <p className="text-muted-foreground text-sm">
      The shell around this page is now{" "}
      <span className="text-foreground font-medium">{values.variant}</span>
      {values.breadcrumbs ? ", with breadcrumbs" : ", without breadcrumbs"}.
    </p>
  );
};

export default Shell;
