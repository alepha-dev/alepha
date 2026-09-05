import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { cn } from "@alepha/ui/lib/utils";
import type { Infer, ZObject } from "alepha";
import { useForm } from "alepha/react/form";
import { type ReactNode, useState } from "react";

export interface ShowcaseProps<T extends ZObject> {
  /**
   * Names the specimen, and titles the props panel.
   */
  title: string;
  description?: string;
  /**
   * The knobs. Every field becomes a control in the right-hand panel, and its
   * current value is handed to `children`.
   */
  schema: T;
  initialValues?: Partial<Infer<T>>;
  /**
   * Renders the component under the current prop values. Called on every
   * change, so it must be cheap and pure.
   */
  children: (values: Infer<T>) => ReactNode;
  /**
   * Height of the preview area. The default suits a single control; a block
   * that needs room (a shell, a table) should ask for more.
   */
  previewClassName?: string;
}

/**
 * A component, and a live panel of its props beside it.
 *
 * This is a rebuild of the `Showcase` that lived in `packages/ui/src/demo`
 * until commit `6dfde2c59`. The idea survives unchanged - a schema, a form
 * bound to it, and a render prop - because it never depended on the parts that
 * dated: that version used TypeBox (`t.object`, `TObject`, `Static`), which was
 * purged before v1, and `TypeForm`, which is now `AutoForm`.
 *
 * ⚠️ `autoSave` is what makes the panel live. Without it `AutoForm` renders a
 * submit button and the preview only updates when the reader presses it, which
 * defeats the point: the value of knobs is turning one and seeing the component
 * move.
 *
 * The values are held in state rather than read from the form, because the
 * form's own values change on every keystroke while `handler` fires on the
 * debounce - so rendering from the form would re-render the preview far more
 * often than the reader can perceive.
 */
export const Showcase = <T extends ZObject>(props: ShowcaseProps<T>) => {
  const [values, setValues] = useState<Record<string, any>>(
    (props.initialValues as Record<string, any>) ?? {},
  );

  const form = useForm(
    {
      schema: props.schema,
      initialValues: props.initialValues as any,
      handler: (next) => setValues(next as Record<string, any>),
    },
    // Anchored on the schema: `useForm` fixes its shape at mount, so a schema
    // rebuilt per render would reset the knobs on every keystroke.
    [props.schema],
  );

  return (
    <section className="border-border/60 overflow-hidden rounded-lg border">
      <header className="border-border/60 border-b px-4 py-3">
        <h3 className="text-sm font-medium">{props.title}</h3>
        {props.description ? (
          <p className="text-muted-foreground mt-0.5 text-xs">
            {props.description}
          </p>
        ) : null}
      </header>

      <div className="flex flex-col lg:flex-row">
        <div
          className={cn(
            "bg-muted/30 flex min-w-0 flex-1 items-center justify-center p-6",
            props.previewClassName,
          )}
        >
          {props.children(values as Infer<T>)}
        </div>

        <div className="border-border/60 bg-background w-full shrink-0 border-t lg:w-72 lg:border-t-0 lg:border-l">
          <div className="border-border/60 border-b px-3 py-2">
            <span className="text-muted-foreground text-xs font-medium">
              Props
            </span>
          </div>
          <div className="p-3">
            <AutoForm form={form} autoSave={{ delay: 150 }} />
          </div>
        </div>
      </div>
    </section>
  );
};
