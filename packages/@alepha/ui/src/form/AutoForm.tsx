import * as React from "react";

void React;

import { type ZObject, type ZType, z } from "alepha";
import { useAlepha } from "alepha/react";
import { type FormModel, useFormState } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { type ReactNode, useEffect, useMemo } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardTitle,
} from "../core/Card.tsx";
import { cn } from "../core/utils.ts";
import { AutoFormBottomBar } from "./AutoFormBottomBar.tsx";
import { AutoFormGroupBlock } from "./AutoFormGroupBlock.tsx";
import { autoGroupSchema } from "./autoFormGroups.ts";
import type { ControlProps } from "./Control.tsx";
import { FormFieldAutoSaveProvider } from "./FormFieldAutoSaveProvider.tsx";
import { FormFieldLayoutProvider } from "./FormFieldLayoutProvider.tsx";
import { FormFieldRequiredMarkerProvider } from "./FormFieldRequiredMarkerProvider.tsx";
import { iconFor } from "./iconHint.tsx";

export interface AutoFormProps<T extends ZObject> {
  /**
   * Form model returned by `useForm()`. The schema drives every field.
   */
  form: FormModel<T>;

  /**
   * Header icon (lucide name).
   */
  icon?: string;
  /**
   * Header title.
   */
  title?: string;
  /**
   * Header description / subtitle.
   */
  description?: string;
  /**
   * Extra content rendered on the right of the header (e.g. a status badge).
   * In `card` mode it renders as the `CardAction`; otherwise it is pushed to
   * the right edge of the header box.
   */
  headerAction?: ReactNode;

  /**
   * Manual layout: list of groups, each with its own fields.
   * If neither `groups` nor `autoGroup` is set, every top-level schema
   * field is rendered in a single ungrouped column.
   */
  groups?: AutoFormGroup[];

  /**
   * Auto-group: scan the schema, primitive fields land in a "General"
   * group, each object/array-of-objects becomes its own group.
   */
  autoGroup?: boolean | { defaultTitle?: string; defaultIcon?: string };

  /**
   * Per-field control overrides keyed by field name (also works without groups).
   */
  fields?: Partial<
    Record<keyof T["shape"] & string, Partial<Omit<ControlProps, "input">>>
  >;

  /**
   * Localize field labels the schema doesn't carry. When set, each field's
   * label is resolved from the app dictionary via
   * `tr(\`${i18nPrefix}.${fieldName}\`)` and its description via
   * `tr(\`${i18nPrefix}.${fieldName}.desc\`)`, falling back to the
   * schema-derived label/description when the key is absent. Lets a generic
   * AutoForm (e.g. the parameters admin, whose schemas rarely set `title`)
   * render translated labels without per-schema annotations. Explicit
   * `fields[name].label` overrides still win.
   */
  i18nPrefix?: string;

  /**
   * Submit button label.
   */
  submitLabel?: string;
  /**
   * Hide built-in submit button.
   */
  noSubmit?: boolean;
  /**
   * Disable submit when form is pristine (not dirty).
   */
  disabledIfPristine?: boolean;
  /**
   * Disable the entire form (cascades to controls).
   */
  disabled?: boolean;

  /**
   * Show the red `*` next to the label of every required field.
   *
   * Set `false` on a form where the marker is not news — one whose fields are
   * nearly all required, or where the one required field is self-evidently so
   * (a project's Name). A page of asterisks tells the reader nothing about
   * which field to be careful with, which is the only thing the marker is for.
   *
   * Purely visual. `aria-required` still comes from the schema, so a screen
   * reader announces the field as required either way — the marker itself is
   * `aria-hidden` and never carried that.
   *
   * @default true
   */
  requiredMarker?: boolean;

  /**
   * Cancel button — hidden when omitted.
   */
  onCancel?: () => void;
  /**
   * Skip the reset button in the bottom bar.
   */
  skipReset?: boolean;
  /**
   * Skip the entire bottom bar.
   */
  skipBottomBar?: boolean;

  /**
   * Extra action buttons in the bottom bar (left side).
   */
  actions?: AutoFormAction[];

  /**
   * Extra content rendered above the bottom bar.
   */
  footer?: ReactNode;

  /**
   * Extra classes applied to the form wrapper.
   */
  className?: string;

  /**
   * Override the column classes of each field group's grid. By default fields
   * lay out on a fixed 12-column grid and each field's span is derived from
   * width heuristics (`$control.width`, type, …).
   *
   * Pass responsive column classes — e.g.
   * `"grid-cols-1 md:grid-cols-2 xl:grid-cols-3"` — to get N equal columns per
   * breakpoint instead; when set, every field occupies a single cell and the
   * per-field width heuristics are ignored.
   */
  gridClassName?: string;

  /**
   * Wrap the form in a `<Card>`:
   * - the header (icon + title/description) renders as the `CardHeader`,
   * - the field groups render as the `CardContent`,
   * - the action bar (cancel / reset / actions / submit) renders as the
   *   `CardFooter`.
   *
   * When omitted, the form uses its default chrome (a muted header box and a
   * standalone bottom bar). The footer is hidden in `autoSave` mode just like
   * the default bottom bar.
   *
   * Pass a string to override the `<Card>` className (e.g. `"rounded-none"` to
   * make the card sit flush against neighbouring panes).
   */
  card?: boolean | string;

  /**
   * Fill the available height: the card stretches to `100%` of its container
   * and the body (field groups) scrolls while the header and footer stay
   * pinned. Only meaningful in `card` mode.
   */
  fill?: boolean;

  /**
   * Visual layout for every nested Control.
   * - `"stack"` (default): label on top, control below — the classic form look.
   * - `"row"`: settings-style — each control sits on its own line with the
   *   label/description on the left and the control on the right. Each
   *   group renders as a bordered card with horizontal dividers.
   *
   * `"row"` **is** the settings-card shape, not an approximation of it: the
   * rows render the same markup as {@link SettingsRow}, the card the same as
   * {@link SettingsSection}, the heading through the same
   * {@link SettingsHeading}, and the action bar as the card's own last
   * divided row. So a settings card whose rows are form fields should be an
   * `AutoForm`, and reach for `SettingsSection` only for the rows that are
   * *not* fields — an avatar picker, a read-only value, a lone button.
   */
  layout?: "stack" | "row";

  /**
   * Auto-commit edits instead of showing a Save button.
   *
   * When enabled, every field change schedules a debounced `form.submit()`
   * and the bottom bar is hidden by default. Pass an options object to
   * customize the debounce delay (default 600ms).
   *
   * The `handler` you pass to `useForm` is the auto-commit target — it
   * runs once per quiescent edit, and any thrown error stops the loop
   * until the user edits again.
   */
  autoSave?: boolean | { delay?: number };
}

/**
 * Schema-driven form with optional grouping, header chrome, and bottom
 * bar. Every input field is resolved through `<Control>`, so schemas
 * carrying `$control` metadata configure themselves.
 */
export const AutoForm = <T extends ZObject>(props: AutoFormProps<T>) => {
  const { tr } = useI18n();
  const { dirty, loading } = useFormState(props.form, ["dirty", "loading"]);
  const inputs = props.form.input as Record<string, never>;

  // `z.object({})` rather than a hand-made `{ properties: {} }`: the latter
  // only ever worked because a prototype alias made `.properties` readable on
  // a schema, so a fake object with that key passed for one.
  const schema = (props.form.options.schema as ZObject) ?? z.object({});

  // ── Auto-save ─────────────────────────────────────────────────────
  // Text fields (string) are intentionally excluded: typing should not commit
  // on every keystroke. They commit via Enter (native submit) or the inline
  // tick button. Booleans / selects / uploads / etc. auto-commit on change.
  const autoSave = props.autoSave;
  const autoSaveDelay =
    typeof autoSave === "object" ? (autoSave?.delay ?? 600) : 600;
  const autoSaveEnabled = !!autoSave;
  const alepha = useAlepha();
  useEffect(() => {
    if (!autoSaveEnabled) return;
    let handle: ReturnType<typeof setTimeout> | undefined;
    const off = alepha.events.on("form:change", (ev) => {
      if (ev.id !== props.form.id) return;
      if (ev.initial) return;
      // FormModel paths look like "/title" or "/contacts/0/email". The
      // top-level key is the first segment after the leading slash.
      const top = ev.path.replace(/^\//, "").split("/")[0];
      const fieldSchema = z.schema.shape(schema)[top];
      const fieldConfig = resolveControlConfig(
        top,
        props.fields as Record<string, unknown> | undefined,
        props.groups,
      );
      // Text fields (incl. optional/nullable wrappers) should NOT auto-commit
      // on keystroke; they commit via Enter or the inline tick button.
      // Uploads commit a uuid string when the upload finishes, and selects /
      // comboboxes / segmented controls commit a discrete value on change —
      // all of those MUST auto-save even though the field schema is a string.
      const rendersAsSelect =
        !!fieldConfig.select ||
        !!fieldConfig.combobox ||
        !!fieldConfig.segmented ||
        fieldConfig.items != null ||
        isEnumSchema(fieldSchema);
      if (
        !fieldConfig.upload &&
        !rendersAsSelect &&
        isStringSchema(fieldSchema)
      )
        return;
      if (handle) clearTimeout(handle);
      handle = setTimeout(() => props.form.submit(), autoSaveDelay);
    });
    return () => {
      off();
      if (handle) clearTimeout(handle);
    };
  }, [
    alepha,
    autoSaveEnabled,
    autoSaveDelay,
    props.form,
    props.fields,
    props.groups,
    schema,
  ]);
  const skipBottomBar = props.skipBottomBar ?? autoSaveEnabled;

  const resolvedGroups: AutoFormGroup[] = useMemo(() => {
    if (props.groups) return props.groups.filter((g) => g.can?.() !== false);
    if (props.autoGroup) {
      const opts = typeof props.autoGroup === "object" ? props.autoGroup : {};
      return autoGroupSchema(schema, { tr, ...opts });
    }
    return [
      {
        fields: Object.keys(z.schema.shape(schema)),
      },
    ];
  }, [props.groups, props.autoGroup, schema]);

  const HeaderIcon = props.icon ? iconFor(props.icon) : undefined;
  const hasHeader = !!(
    props.title ||
    props.description ||
    HeaderIcon ||
    props.headerAction
  );

  const layout = props.layout ?? "stack";

  const bottomBarProps = {
    form: props.form,
    dirty,
    loading,
    disabled: props.disabled,
    disabledIfPristine: props.disabledIfPristine,
    submitLabel: props.submitLabel,
    noSubmit: props.noSubmit,
    onCancel: props.onCancel,
    skipReset: props.skipReset,
    actions: props.actions,
  };

  // In row layout the action bar is the card's own last row, not a second
  // bordered box floating under it — see the `layout` prop's note. `card`
  // mode already owns its footer (`CardFooter`), and a form that resolved to
  // no groups at all has nothing to put the bar inside, so both fall back to
  // the standalone bar below.
  const inCardBottomBar =
    layout === "row" &&
    !props.card &&
    !skipBottomBar &&
    resolvedGroups.length ? (
      <AutoFormBottomBar {...bottomBarProps} bare />
    ) : undefined;

  const fieldGroups = (
    <FormFieldLayoutProvider value={layout}>
      <FormFieldRequiredMarkerProvider value={props.requiredMarker ?? true}>
        <FormFieldAutoSaveProvider value={autoSaveEnabled}>
          {resolvedGroups.map((group, gi) => (
            <AutoFormGroupBlock
              key={gi}
              group={group}
              inputs={inputs}
              disabled={props.disabled}
              fields={props.fields}
              i18nPrefix={props.i18nPrefix}
              multiGroup={resolvedGroups.length > 1}
              layout={layout}
              gridClassName={props.gridClassName}
              bottomBar={
                gi === resolvedGroups.length - 1 ? inCardBottomBar : undefined
              }
            />
          ))}
        </FormFieldAutoSaveProvider>
      </FormFieldRequiredMarkerProvider>
    </FormFieldLayoutProvider>
  );

  if (props.card) {
    const cardClassName =
      typeof props.card === "string" ? props.card : undefined;
    return (
      <form
        {...props.form.props}
        className={cn(
          props.fill && "flex h-full min-h-0 flex-col",
          props.className,
        )}
      >
        <Card
          className={cn(
            props.fill && "min-h-0 flex-1",
            // Header owns its bottom padding (pb-3); trim the card's top
            // padding to match so header top/bottom are an even 12px.
            hasHeader && "pt-3",
            cardClassName,
          )}
        >
          {hasHeader && (
            // Explicit flex header (not shadcn CardHeader): CardHeader's grid
            // adds a phantom second row + row-gap below the title whenever a
            // CardDescription is nested, making the bottom padding larger than
            // the top. A plain flex row keeps top/bottom padding symmetric.
            <div
              data-slot="card-header"
              className="flex items-start justify-between gap-3 border-b px-4 pb-3"
            >
              <div className="flex items-center gap-3">
                {HeaderIcon && (
                  <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
                    <HeaderIcon className="size-5" />
                  </div>
                )}
                <div className="flex flex-col gap-0">
                  {props.title && <CardTitle>{props.title}</CardTitle>}
                  {props.description && (
                    <CardDescription>{props.description}</CardDescription>
                  )}
                </div>
              </div>
              {props.headerAction && (
                <div className="shrink-0">{props.headerAction}</div>
              )}
            </div>
          )}
          <CardContent
            className={cn(
              "flex flex-col gap-4",
              // `relative` alongside the scroller, not decoration: Base UI
              // gives every named control a 1×1 hidden `<input>` positioned
              // `absolute` with no offsets, and a scroller that is not itself
              // a containing block neither clips those inputs nor scrolls
              // them with the field they belong to — so a native validation
              // bubble would point at where the field used to be. #1849.
              props.fill && "relative min-h-0 flex-1 overflow-y-auto",
            )}
          >
            {fieldGroups}
            {props.footer}
          </CardContent>
          {!skipBottomBar && (
            <CardFooter>
              <AutoFormBottomBar {...bottomBarProps} bare />
            </CardFooter>
          )}
        </Card>
      </form>
    );
  }

  return (
    <form {...props.form.props} className={props.className}>
      <div className="flex flex-col gap-4">
        {hasHeader && (
          <div className="bg-muted/40 flex items-start gap-3 rounded-md border p-4">
            {HeaderIcon && (
              <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
                <HeaderIcon className="size-5" />
              </div>
            )}
            <div className="flex flex-col gap-1">
              {props.title && (
                <h2 className="text-base font-semibold">{props.title}</h2>
              )}
              {props.description && (
                <p className="text-muted-foreground text-sm">
                  {props.description}
                </p>
              )}
            </div>
            {props.headerAction && (
              <div className="ml-auto">{props.headerAction}</div>
            )}
          </div>
        )}

        {fieldGroups}

        {props.footer}

        {!skipBottomBar && !inCardBottomBar && (
          <AutoFormBottomBar {...bottomBarProps} />
        )}
      </div>
    </form>
  );
};

export interface AutoFormGroup {
  /**
   * Group title shown in the header.
   */
  title?: string;
  /**
   * One line under the title, for context the fields should not each repeat.
   *
   * Only rendered in `layout="row"`, where the heading sits above the card
   * and there is room for it — the boxed group bar the grid layout uses is a
   * single line by construction.
   */
  description?: string;
  /**
   * Icon name (lucide) for the group header.
   */
  icon?: string;
  /**
   * Visibility predicate. Group is omitted when this returns false.
   */
  can?: () => boolean;
  /**
   * Field names from the form schema. Each renders as a `<Control>`.
   * Use the object form `{ name, ...controlProps }` for per-field overrides
   * (width, icon, custom, etc.).
   */
  fields: Array<
    string | (Partial<Omit<ControlProps, "input">> & { name: string })
  >;
}

export interface AutoFormAction {
  label: string;
  icon?: string;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  onClick: () => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Detect a `z.string()` schema (incl. optional/nullable wrappers) so the
 * auto-save effect can skip keystroke commits on text fields.
 */
function isStringSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  // Zod, not JSON Schema: `z.string().optional()` has no `type: "string"`,
  // so the optional text fields of a form used to auto-save every keystroke.
  const inner = z.schema.unwrap(schema as ZType);
  if (z.schema.isString(inner)) return true;
  if (z.schema.isUnion(inner)) {
    return z.schema.options(inner).some(isStringSchema);
  }
  return false;
}

/**
 * Detect an enum schema (incl. optional/nullable wrappers). Enum fields
 * render as a `<Select>`, so they must auto-commit on change like any
 * other select — never get lumped in with free-text string fields.
 */
function isEnumSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const inner = z.schema.unwrap(schema as ZType);
  if (z.schema.isEnum(inner)) return true;
  if (z.schema.isUnion(inner)) {
    return z.schema.options(inner).some(isEnumSchema);
  }
  return false;
}

/**
 * Resolve the effective `<Control>` config for a field, merging the
 * `fields` map with any per-field override carried on a `groups` entry —
 * the same precedence `AutoFormGroupBlock` applies when rendering.
 */
function resolveControlConfig(
  name: string,
  fields: Record<string, unknown> | undefined,
  groups: AutoFormGroup[] | undefined,
): Record<string, unknown> {
  const fromMap = (fields?.[name] as Record<string, unknown>) ?? {};
  let fromGroup: Record<string, unknown> = {};
  for (const group of groups ?? []) {
    for (const field of group.fields) {
      if (typeof field === "object" && field.name === name) {
        fromGroup = field as Record<string, unknown>;
      }
    }
  }
  return { ...fromMap, ...fromGroup };
}
