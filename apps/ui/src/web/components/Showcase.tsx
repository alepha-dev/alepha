import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Button } from "@alepha/ui/components/ui/button";
import { cn } from "@alepha/ui/lib/utils";
import type { Infer, ZObject } from "alepha";
import { useForm } from "alepha/react/form";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { type ReactNode, useState } from "react";

export interface ShowcaseProps<T extends ZObject> {
  title: string;
  /**
   * One line at most. The component is the explanation; prose here just pushes
   * it below the fold.
   */
  description?: string;
  /**
   * The knobs. Every field becomes a control in the right-hand panel, and its
   * current value is handed to `children`.
   */
  schema: T;
  initialValues?: Partial<Infer<T>>;
  children: (values: Infer<T>) => ReactNode;
  previewClassName?: string;
}

/**
 * A component, and a live panel of its props beside it.
 *
 * A rebuild of the `Showcase` that lived in `packages/ui/src/demo` until commit
 * `6dfde2c59`. The idea survives unchanged - a schema, a form bound to it, and
 * a render prop - because it never depended on what dated: that version used
 * TypeBox and `TypeForm`, now zod and `AutoForm`.
 *
 * ⚠️ `autoSave` is what makes the panel live. Without it `AutoForm` renders a
 * submit button and the preview only moves when the reader presses it, which
 * defeats the point.
 *
 * The panel collapses, because the preview is the subject: a wide component
 * (a shell, a table, a split auth screen) needs the width more than the knobs
 * need to stay visible.
 */
export const Showcase = <T extends ZObject>(props: ShowcaseProps<T>) => {
  const [values, setValues] = useState<Record<string, any>>(
    (props.initialValues as Record<string, any>) ?? {},
  );
  const [open, setOpen] = useState(true);

  const form = useForm(
    {
      schema: props.schema,
      initialValues: props.initialValues as any,
      handler: (next) => setValues(next as Record<string, any>),
    },
    // `useForm` fixes its shape at mount, so a schema rebuilt per render would
    // reset the knobs on every keystroke.
    [props.schema],
  );

  return (
    <section className="border-border/60 overflow-hidden rounded-lg border">
      <header className="border-border/60 flex items-center justify-between gap-3 border-b px-4 py-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{props.title}</h3>
          {props.description ? (
            <p className="text-muted-foreground truncate text-xs">
              {props.description}
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={open ? "Hide props" : "Show props"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
        </Button>
      </header>

      <div className="flex flex-col lg:flex-row">
        <div
          className={cn(
            "bg-muted/20 min-w-0 flex-1 p-6",
            props.previewClassName,
          )}
        >
          {props.children(values as Infer<T>)}
        </div>

        {open ? (
          <div className="border-border/60 bg-background w-full shrink-0 border-t lg:w-64 lg:border-t-0 lg:border-l">
            <div className="p-3">
              <AutoForm form={form} autoSave={{ delay: 150 }} />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
};
