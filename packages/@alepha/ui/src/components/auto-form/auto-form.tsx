import * as React from "react";

void React;

import {
  FormFieldAutoSaveProvider,
  FormFieldLayoutProvider,
  FormFieldRequiredMarkerProvider,
} from "@alepha/ui/components/control-base/form-field";
import { spanClass, widthFor } from "@alepha/ui/components/control-base/grid";
import { iconFor } from "@alepha/ui/components/control-base/icon-hint";
import {
  Control,
  type ControlProps,
} from "@alepha/ui/components/control/control";
import { SettingsHeading } from "@alepha/ui/components/settings/settings-heading";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui/components/ui/popover";
import { cn } from "@alepha/ui/lib/utils";
import { type ZObject, z } from "alepha";
import { useAlepha } from "alepha/react";
import {
  type BaseInputField,
  type FormModel,
  isObjectOrUnionOfObjects,
  useFormState,
} from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { AlertCircle, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

/**
 * Detect a `z.string()` schema (incl. optional/nullable wrappers) so the
 * auto-save effect can skip keystroke commits on text fields.
 */
function isStringSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const s = schema as { type?: unknown; anyOf?: unknown[] };
  if (s.type === "string") return true;
  if (Array.isArray(s.anyOf)) return s.anyOf.some(isStringSchema);
  return false;
}

/**
 * Detect an enum schema (incl. optional/nullable wrappers). Enum fields
 * render as a `<Select>`, so they must auto-commit on change like any
 * other select — never get lumped in with free-text string fields.
 */
function isEnumSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const s = schema as { enum?: unknown[]; anyOf?: unknown[] };
  if (Array.isArray(s.enum)) return true;
  if (Array.isArray(s.anyOf)) return s.anyOf.some(isEnumSchema);
  return false;
}

/**
 * Resolve the effective `<Control>` config for a field, merging the
 * `fields` map with any per-field override carried on a `groups` entry —
 * the same precedence `GroupBlock` applies when rendering.
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
export function AutoForm<T extends ZObject>(props: AutoFormProps<T>) {
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
      <BottomBar {...bottomBarProps} bare />
    ) : undefined;

  const fieldGroups = (
    <FormFieldLayoutProvider value={layout}>
      <FormFieldRequiredMarkerProvider value={props.requiredMarker ?? true}>
        <FormFieldAutoSaveProvider value={autoSaveEnabled}>
          {resolvedGroups.map((group, gi) => (
            <GroupBlock
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
              props.fill && "min-h-0 flex-1 overflow-y-auto",
            )}
          >
            {fieldGroups}
            {props.footer}
          </CardContent>
          {!skipBottomBar && (
            <CardFooter>
              <BottomBar {...bottomBarProps} bare />
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
          <BottomBar {...bottomBarProps} />
        )}
      </div>
    </form>
  );
}

// ──────────────────────────────────────────────────────────────────────

interface GroupBlockProps {
  group: AutoFormGroup;
  inputs: Record<string, never>;
  fields?: Partial<Record<string, Partial<Omit<ControlProps, "input">>>>;
  i18nPrefix?: string;
  disabled?: boolean;
  multiGroup?: boolean;
  layout: "stack" | "row";
  gridClassName?: string;
  /**
   * The form's action bar, rendered as this group's last divided row. Set by
   * `AutoForm` on the *last* group in `layout="row"`; `undefined` everywhere
   * else, including every group in the grid layout.
   */
  bottomBar?: ReactNode;
}

function GroupBlock(props: GroupBlockProps) {
  const { group } = props;
  const { tr } = useI18n();
  const Icon = group.icon ? iconFor(group.icon) : undefined;

  const items = group.fields
    .map((entry) => {
      const name = typeof entry === "string" ? entry : entry.name;
      const override =
        typeof entry === "object" ? (entry as Partial<ControlProps>) : {};
      const input = props.inputs[name];
      if (!input) return null;
      const fromMap = props.fields?.[name] ?? {};
      const merged: Partial<ControlProps> = {
        ...fromMap,
        ...override,
      };
      // i18nPrefix: fill label/description from the dictionary when neither
      // the override nor the schema already provides one. A missing key
      // makes `tr` echo the key back (an empty `default` is falsy, so the
      // provider can't substitute it) — guard with `!== key` so an absent
      // entry leaves the Control to fall back to `schema.title ??
      // prettyName(field)`, preserving current behaviour.
      if (props.i18nPrefix && merged.label === undefined) {
        const key = `${props.i18nPrefix}.${name}`;
        const label = tr(key, { default: "" });
        if (label && label !== key) merged.label = label;
      }
      if (props.i18nPrefix && merged.description === undefined) {
        const key = `${props.i18nPrefix}.${name}.desc`;
        const desc = tr(key, { default: "" });
        if (desc && desc !== key) merged.description = desc;
      }
      // Hand the extended prefix down so an object's children and an array's
      // item fields resolve their own labels/help
      // (`parameters.x.payg.dailyCapCents.desc`).
      if (props.i18nPrefix && merged.i18nPrefix === undefined) {
        merged.i18nPrefix = `${props.i18nPrefix}.${name}`;
      }
      return { name, input, props: merged };
    })
    .filter(Boolean) as Array<{
    name: string;
    input: BaseInputField;
    props: Partial<ControlProps>;
  }>;

  // `!props.bottomBar`: a group carrying the action bar still renders when it
  // has no resolvable fields, or the form would silently lose its submit
  // button rather than merely render empty.
  if (!items.length && !props.multiGroup && !props.bottomBar) return null;

  // Naked group: no title, no icon → no card chrome (lets solo complex
  // fields render with just their own header).
  const isNaked = !group.title && !Icon;

  // Row layout: each group becomes a divider-stacked card, every Control
  // takes a full row through its own FormField row layout (via context).
  if (props.layout === "row") {
    const hasHeading = !!(group.title || group.description);
    return (
      <div>
        {hasHeading && (
          // `SettingsHeading` rather than a local span pair: this is the same
          // heading `SettingsSection` renders, and the whole reason that
          // component exists is that there be exactly one of it. `items-start`
          // + `mt-0.5` keeps the icon on the title line when a description
          // wraps a second one under it.
          <div className="mb-2 flex items-start gap-2">
            {Icon && (
              <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            )}
            <SettingsHeading
              title={group.title}
              description={group.description}
            />
          </div>
        )}
        <div className="bg-card divide-y rounded-lg border shadow-sm">
          {items.map((it) => (
            <Control
              key={it.name}
              input={it.input}
              {...it.props}
              disabled={props.disabled || it.props.disabled}
            />
          ))}
          {props.bottomBar && (
            // Same `px-4 py-3` every row carries, so the action row sits on
            // the card's own rhythm and `divide-y` draws its rule flush.
            <div className="px-4 py-3">{props.bottomBar}</div>
          )}
        </div>
      </div>
    );
  }

  const wrapperCls =
    props.multiGroup && !isNaked ? "border rounded-md overflow-hidden" : "";

  return (
    <div className={wrapperCls}>
      {props.multiGroup && !isNaked && (
        <div className="bg-muted/40 flex items-center gap-2 border-b px-3 py-2">
          {Icon && <Icon className="text-muted-foreground size-4" />}
          {group.title && (
            <span className="text-sm font-medium">{group.title}</span>
          )}
        </div>
      )}
      <div
        className={cn(
          "grid gap-3",
          props.gridClassName ?? "grid-cols-12",
          !isNaked && "p-3",
        )}
      >
        {items.map((it) => (
          <div
            key={it.name}
            className={
              // Responsive grid: each field is one cell. Default: 12-col span
              // from width heuristics. A caller-supplied grid keeps its own
              // column count for scalars, but COMPLEX fields (an object card,
              // a list of object editors) still claim the whole row —
              // squeezing one into a third of a row is unreadable, and the
              // heuristic already knows which those are (width 100).
              props.gridClassName
                ? widthFor(it.input, it.props.width as number | undefined) >=
                  100
                  ? "col-span-full"
                  : undefined
                : spanClass(
                    widthFor(it.input, it.props.width as number | undefined),
                  )
            }
          >
            <Control
              input={it.input}
              {...it.props}
              disabled={props.disabled || it.props.disabled}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────

interface BottomBarProps {
  form: FormModel<ZObject>;
  dirty?: boolean;
  loading?: boolean;
  disabled?: boolean;
  disabledIfPristine?: boolean;
  submitLabel?: string;
  noSubmit?: boolean;
  onCancel?: () => void;
  skipReset?: boolean;
  actions?: AutoFormAction[];
  /**
   * Drop the standalone chrome (border / rounded / background / padding) so
   * the bar slots into a `CardFooter`, which provides that chrome itself.
   */
  bare?: boolean;
}

function BottomBar(props: BottomBarProps) {
  const { tr } = useI18n();
  return (
    <div
      className={
        props.bare
          ? "flex w-full items-center gap-2"
          : "bg-card flex items-center gap-2 rounded-md border p-2"
      }
    >
      {props.onCancel && (
        <Button
          type="button"
          variant="ghost"
          onClick={props.onCancel}
          disabled={props.disabled}
        >
          <X className="mr-1 size-4" />
          {tr("autoForm.cancel", { default: "Cancel" })}
        </Button>
      )}
      {!props.skipReset && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => props.form.reset()}
          disabled={props.disabled || !props.dirty}
        >
          {/* No icon, deliberately. The submit button next to it carries none
              — a glyph would have to be either a dated floppy disk or a tick
              that reads as "done" rather than "do it" — and a bar where only
              some buttons are decorated reads as unfinished rather than as a
              hierarchy. `Button` still shows a spinner while submitting,
              which is the one icon here that carries information. */}
          {tr("autoForm.reset", { default: "Reset" })}
        </Button>
      )}
      {props.actions?.map((action, i) => {
        const Icon = action.icon ? iconFor(action.icon) : undefined;
        return (
          <Button
            key={i}
            type="button"
            variant={action.variant ?? "ghost"}
            onClick={() => action.onClick()}
            disabled={props.disabled || action.disabled}
          >
            {Icon && <Icon className="mr-1 size-4" />}
            {action.label}
          </Button>
        );
      })}

      <div className="ml-auto flex items-center gap-2">
        <FormErrorPopover form={props.form} />
        {!props.noSubmit && (
          <Button
            type="submit"
            loading={props.loading}
            disabled={
              props.disabled || (props.disabledIfPristine && !props.dirty)
            }
          >
            {props.submitLabel ?? tr("autoForm.save", { default: "Save" })}
          </Button>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────

interface FormErrorPopoverProps {
  form: FormModel<ZObject>;
}

function FormErrorPopover(props: FormErrorPopoverProps) {
  const { error } = useFormState(props.form, ["error"]);
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  // Close the popover when the error clears. Guarded on `open`, so it settles
  // in one pass and does not need an effect.
  if (!error && open) {
    setOpen(false);
  }

  if (!error) return null;

  const items = collectErrors(error);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={tr("autoForm.errors", { default: "Form errors" })}
            className="text-destructive"
          />
        }
      >
        <AlertCircle className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <p className="text-destructive px-2 py-1 text-sm font-medium">
          {items.length === 1
            ? tr("autoForm.error", { default: "Error" })
            : tr("autoForm.errors", { default: "Errors" })}
        </p>
        <ul className="flex flex-col gap-1">
          {items.map((it, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => focusError(it.path, props.form.id)}
                className="hover:bg-accent w-full rounded px-2 py-1 text-left text-xs"
              >
                <span className="font-medium">
                  {it.path || tr("autoForm.formLabel", { default: "Form" })}
                </span>
                <span className="text-muted-foreground"> — {it.message}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

interface ErrorItem {
  path: string;
  message: string;
}

const collectErrors = (error: Error): ErrorItem[] => {
  const anyErr = error as Error & {
    value?: { message?: string; path?: string };
  };
  const path = anyErr.value?.path ?? "";
  const message = anyErr.value?.message ?? error.message ?? "Invalid";
  return [{ path, message }];
};

const focusError = (path: string, formId: string) => {
  const fieldName = path.replace(/^\//, "").replace(/\//g, ".");
  if (!fieldName) return;
  const el =
    document.getElementById(`${formId}-${fieldName}`) ??
    document.querySelector<HTMLElement>(`[name="${fieldName}"]`);
  el?.focus();
};

// ──────────────────────────────────────────────────────────────────────

const autoGroupSchema = (
  schema: ZObject,
  opts: {
    defaultTitle?: string;
    defaultIcon?: string;
    /** Translator for the fallback group title (the helper is hook-free). */
    tr?: (key: string, options?: { default?: string }) => string;
  },
): AutoFormGroup[] => {
  const general: AutoFormGroup = {
    title:
      opts.defaultTitle ??
      opts.tr?.("autoForm.general", { default: "General" }) ??
      "General",
    icon: opts.defaultIcon ?? "cog",
    fields: [],
  };
  const groups: AutoFormGroup[] = [];

  for (const [key, prop] of Object.entries(z.schema.shape(schema))) {
    const p = prop as {
      type?: string;
      items?: unknown;
      element?: unknown;
    };
    const isObject = p.type === "object";
    // An array of a UNION of objects is a complex field too — without this it
    // lands in the "General" grid and gets a third of a row to render a list
    // of object editors in.
    const isArrayOfObjects =
      p.type === "array" && isObjectOrUnionOfObjects(p.element);
    if (isObject || isArrayOfObjects) {
      // Solo complex fields render their own header (label + description +
      // chevron + add/init), so we skip the group bar to avoid a
      // duplicate title row.
      groups.push({ fields: [key] });
    } else {
      general.fields.push(key);
    }
  }

  if (general.fields.length === 0) return groups;
  return [general, ...groups];
};
