import { z } from "alepha";
import { useStore } from "alepha/react";
import { useEffect } from "react";

import { Showcase } from "@/web/components/Showcase.tsx";
import { shellPrefsAtom } from "@/web/shellPrefsAtom.ts";

/**
 * The knobs drive the REAL shell around this page rather than a copy.
 *
 * Nesting an `AppShell` inside the one already wrapping every page would put
 * two `SidebarProvider`s in a fight over the same collapse state, and the
 * preview would not be the thing being documented anyway.
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
    <Showcase
      id="blocks/Shell"
      title="App shell"
      description="The frame around every page. The knobs change the real one."
      schema={KNOBS}
      initialValues={prefs}
    >
      {(v) => <Sync values={v} apply={setPrefs} />}
    </Showcase>
  );
};

const Sync = (props: {
  values: { variant: any; headerOutside: boolean; breadcrumbs: boolean };
  apply: (v: any) => void;
}) => {
  const { values, apply } = props;

  useEffect(() => {
    apply(values);
  }, [values.variant, values.headerOutside, values.breadcrumbs]);

  return (
    <div className="max-w-2xl space-y-4 text-sm">
      <p>
        The shell around this page is now{" "}
        <span className="font-medium">{values.variant}</span>
        {values.breadcrumbs ? ", with breadcrumbs" : ", without breadcrumbs"}.
      </p>
      <ul className="text-muted-foreground list-disc space-y-1 pl-5">
        <li>
          <span className="text-foreground font-medium">sidebar</span> - flush,
          side by side.
        </li>
        <li>
          <span className="text-foreground font-medium">floating</span> - the
          page owns the background, the sidebar is a card on it.
        </li>
        <li>
          <span className="text-foreground font-medium">inset</span> - the
          sidebar owns the background, the page is the card.
        </li>
        <li>
          <span className="text-foreground font-medium">headerOutside</span>{" "}
          applies to inset alone, which is why its switch disables itself
          elsewhere.
        </li>
      </ul>
    </div>
  );
};

export default Shell;
