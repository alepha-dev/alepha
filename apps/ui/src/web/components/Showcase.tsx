import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Button } from "@alepha/ui/components/ui/button";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import { cn } from "@alepha/ui/lib/utils";
import type { Infer, ZObject } from "alepha";
import { useAlepha } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useRouterState } from "alepha/react/router";
import {
  Monitor,
  PanelRightClose,
  PanelRightOpen,
  Smartphone,
  Tablet,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { PREVIEW_PATH } from "@/web/pages/PreviewFrame.tsx";

/**
 * Preview widths. `full` is not a device - it is the absence of a constraint,
 * and it is the default because most of what this site shows is a component
 * rather than a page.
 *
 * The three named widths render in an IFRAME, which is the only way the
 * component under test actually sees them: see `PreviewFrame`.
 */
const VIEWPORTS = {
  full: { label: "Full", width: undefined, icon: Monitor },
  desktop: { label: "Desktop", width: 1280, icon: Monitor },
  tablet: { label: "Tablet", width: 768, icon: Tablet },
  mobile: { label: "Mobile", width: 375, icon: Smartphone },
} as const;

type ViewportId = keyof typeof VIEWPORTS;

/**
 * How the parent hands new knob values to the frame.
 *
 * Not the query string. Putting the values in `src` reloads the whole frame -
 * a fresh app boot - on every settled keystroke, and the reader watches the
 * component they are configuring flash white. `src` therefore carries only
 * the page id and never changes.
 */
const KNOBS_MESSAGE = "showcase:knobs";

export interface ShowcaseProps<T extends ZObject> {
  /**
   * This page's module path under `web/pages/`, without the extension:
   * `blocks/Table`, `pages/admin/Users`.
   *
   * It is what `/preview` loads for the viewport iframe, resolved through a
   * `import.meta.glob`, so a wrong value fails loudly in the frame rather than
   * rendering something else.
   */
  id: string;
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
 * by their `$control.width`, which in a narrow panel puts two half-width knobs
 * side by side and truncates both labels.
 *
 * ⚠️ `showcase-props` is not decoration. In row layout `Control` gives a text
 * input `sm:w-64`, a flat 256px, and this panel's rows are 293px wide: the
 * label column was squeezed to ZERO and its text painted straight over the
 * input. `sm:` is a viewport query answering a container question, so the
 * component sees a 1280px window and picks the wide branch for a box a quarter
 * that size. `main.css` overrides the width for this panel only.
 *
 * Keep a knob's `title` short anyway - the label column is ~120px even after
 * the override - and skip `describe()` here: the knob's effect is visible in
 * the preview a few pixels to its left.
 */
export const Showcase = <T extends ZObject>(props: ShowcaseProps<T>) => {
  const state = useRouterState();

  /**
   * The same component renders both sides of the iframe. Inside it there is no
   * chrome to draw - the parent already drew it - and the knobs arrive by
   * message instead of from a panel that is not there.
   */
  const bare = state.url.pathname === PREVIEW_PATH;

  const [values, setValues] = useState<Record<string, any>>(
    (props.initialValues as Record<string, any>) ?? {},
  );
  const [open, setOpen] = useState(true);
  const [viewport, setViewport] = useState<ViewportId>("full");
  const frame = useRef<HTMLIFrameElement>(null);

  const form = useForm(
    {
      schema: (props.schema ?? undefined) as any,
      initialValues: props.initialValues as any,
      handler: (next) => setValues(next as Record<string, any>),
    },
    [props.schema],
  );

  /**
   * Every keystroke reaches the preview, including in a TEXT knob.
   *
   * `autoSave` alone does not do this, on purpose: its effect skips text
   * fields so a real settings form does not fire a request per character, and
   * leaves them to Enter or the inline tick. That trade is right for a form
   * that saves to a server and wrong for this panel, which writes React state
   * a few pixels from the thing it changes - a reader typing a button's label
   * watched nothing happen until they found a tick they had no reason to look
   * for.
   *
   * So the panel listens to the form's own change events instead of waiting
   * for a commit. `autoSave` stays on for the switches and selects, which it
   * does commit.
   */
  const alepha = useAlepha();
  useEffect(() => {
    if (bare || !props.schema) return;
    const off = alepha.events.on("form:change", (ev: any) => {
      if (ev.id !== form.id || ev.initial) return;
      setValues({ ...form.currentValues });
    });
    return off;
  }, [alepha, bare, form, props.schema]);

  // Inside the frame: take knob values from the parent as they change.
  useEffect(() => {
    if (!bare) return;
    const onMessage = (event: MessageEvent) => {
      // Same-origin only. The frame is served by this app and nothing else has
      // any business driving it.
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== KNOBS_MESSAGE) return;
      setValues(event.data.values ?? {});
    };
    window.addEventListener("message", onMessage);
    // The parent may have posted before this listener existed, so ask.
    window.parent?.postMessage({ type: `${KNOBS_MESSAGE}:ready` }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [bare]);

  // Outside it: push them, and answer the frame's ready ping.
  useEffect(() => {
    if (bare) return;
    const post = () =>
      frame.current?.contentWindow?.postMessage(
        { type: KNOBS_MESSAGE, values },
        window.location.origin,
      );
    post();
    const onReady = (event: MessageEvent) => {
      if (event.data?.type === `${KNOBS_MESSAGE}:ready`) post();
    };
    window.addEventListener("message", onReady);
    return () => window.removeEventListener("message", onReady);
  }, [bare, values]);

  if (bare) {
    return (
      <div
        className={cn(
          "p-6",
          props.center && "grid min-h-svh place-items-center",
        )}
      >
        {props.children(values as Infer<T>)}
      </div>
    );
  }

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
        {/* Two elements, two jobs: this one is the SCROLLER, and the one
            inside it carries the viewport's width. A single div cannot be
            both - constraining the width of the scroller would narrow the
            scrollbar's track along with the preview. */}
        <div
          data-testid="showcase-scroll"
          className={cn(
            "bg-muted/20 min-h-0 min-w-0 flex-1 overflow-auto",
            // Padding lives on the SCROLLER when a frame is shown, never on
            // the frame's own box: `width` is the viewport the reader asked
            // for, and padding or a border inside it would hand the page a
            // narrower window than the label promises. 375 has to mean 375.
            width && "p-4",
          )}
        >
          <div
            data-testid="showcase-preview"
            data-viewport={viewport}
            className={cn(
              "mx-auto",
              width
                ? "h-full min-h-96 overflow-hidden rounded-lg shadow-sm"
                : cn(
                    "min-h-full p-6",
                    props.center && "flex items-center justify-center",
                  ),
            )}
            style={width ? { width } : undefined}
          >
            {width ? (
              <iframe
                ref={frame}
                data-testid="showcase-frame"
                title={`${props.title} at ${VIEWPORTS[viewport].label} width`}
                // Only the page id, never the values: see KNOBS_MESSAGE.
                src={`${PREVIEW_PATH}?p=${encodeURIComponent(props.id)}`}
                className="bg-background block h-full w-full border-0"
              />
            ) : (
              props.children(values as Infer<T>)
            )}
          </div>
        </div>

        {props.schema && open ? (
          <div className="showcase-props border-border/60 bg-background w-80 shrink-0 overflow-auto border-l">
            <div className="p-3">
              <AutoForm form={form} autoSave={{ delay: 150 }} layout="row" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
