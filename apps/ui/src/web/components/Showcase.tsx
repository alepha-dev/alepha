import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Button } from "@alepha/ui/components/ui/button";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { cn } from "@alepha/ui/lib/utils";
import type { Infer, ZObject } from "alepha";
import { useForm } from "alepha/react/form";
import {
  Monitor,
  PanelRightClose,
  PanelRightOpen,
  Smartphone,
  Tablet,
} from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * Preview widths. `full` is not a device - it is the absence of a constraint,
 * and it is the default because most of what this site shows is a component
 * rather than a page.
 */
const VIEWPORTS = {
  full: { label: "Full", width: undefined, icon: Monitor },
  desktop: { label: "Desktop", width: 1280, icon: Monitor },
  tablet: { label: "Tablet", width: 768, icon: Tablet },
  mobile: { label: "Mobile", width: 375, icon: Smartphone },
} as const;

type ViewportId = keyof typeof VIEWPORTS;

export interface ShowcaseProps<T extends ZObject> {
  title: string;
  /**
   * One line at most.
   */
  description?: string;
  /**
   * The knobs. Omit for a component with nothing to configure: the panel and
   * its toggle disappear, and the viewport control stays.
   */
  schema?: T;
  initialValues?: Partial<Infer<T>>;
  children: (values: Infer<T>) => ReactNode;
  /**
   * Centres the preview and lets it size to its content, instead of filling
   * the frame. For a single control, filling looks like a bug.
   */
  center?: boolean;
}

/**
 * A component, a live panel of its props, and a viewport control.
 *
 * One per page, filling the page: the component is the subject, so it gets the
 * whole frame rather than a card in a column of prose.
 *
 * ⚠️ `autoSave` is what makes the panel live. Without it `AutoForm` renders a
 * submit button and the preview only moves when the reader presses it.
 *
 * The props form is forced to ONE COLUMN. `AutoForm` otherwise lays fields out
 * by their `$control.width`, which in a 16rem panel puts two half-width knobs
 * side by side and truncates both labels.
 */
export const Showcase = <T extends ZObject>(props: ShowcaseProps<T>) => {
  const [values, setValues] = useState<Record<string, any>>(
    (props.initialValues as Record<string, any>) ?? {},
  );
  const [open, setOpen] = useState(true);
  const [viewport, setViewport] = useState<ViewportId>("full");

  const form = useForm(
    {
      schema: (props.schema ?? undefined) as any,
      initialValues: props.initialValues as any,
      handler: (next) => setValues(next as Record<string, any>),
    },
    [props.schema],
  );

  const width = VIEWPORTS[viewport].width;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="border-border/60 flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{props.title}</h2>
          {props.description ? (
            <p className="text-muted-foreground truncate text-xs">
              {props.description}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Segmented
            value={viewport}
            onChange={(v) => setViewport(v as ViewportId)}
            options={(Object.keys(VIEWPORTS) as ViewportId[]).map((id) => ({
              value: id,
              label: VIEWPORTS[id].label,
            }))}
          />

          {props.schema ? (
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
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="bg-muted/20 min-h-0 min-w-0 flex-1 overflow-auto">
          <div
            data-testid="showcase-preview"
            data-viewport={viewport}
            className={cn(
              "mx-auto min-h-full p-6",
              props.center && "flex items-center justify-center",
            )}
            style={width ? { maxWidth: width } : undefined}
          >
            {props.children(values as Infer<T>)}
          </div>
        </div>

        {props.schema && open ? (
          <div className="border-border/60 bg-background w-72 shrink-0 overflow-auto border-l">
            <div className="p-3">
              <AutoForm form={form} autoSave={{ delay: 150 }} layout="row" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
