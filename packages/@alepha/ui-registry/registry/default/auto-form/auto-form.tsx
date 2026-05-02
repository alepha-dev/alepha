import type { TObject } from "alepha";
import {
  type BaseInputField,
  type FormModel,
  useFormState,
} from "alepha/react/form";
import { AlertCircle, RotateCcw, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Control, type ControlProps } from "@/registry/default/control/control";
import { spanClass, widthFor } from "@/registry/default/control-base/grid";
import { iconFor } from "@/registry/default/control-base/icon-hint";

export interface AutoFormGroup {
  /** Group title shown in the header. */
  title?: string;
  /** Icon name (lucide) for the group header. */
  icon?: string;
  /** Visibility predicate. Group is omitted when this returns false. */
  can?: () => boolean;
  /**
   * Field names from the form schema. Each renders as a `<Control>`.
   * Use the object form `{ name, ...controlProps }` for per-field overrides
   * (width, icon, custom, etc.).
   */
  fields: Array<
    string | (Partial<Omit<ControlProps, "input">> & { name: string })
  >;
  /**
   * @deprecated Layout is now a 12-col grid driven by per-field width
   * heuristics (mirroring the legacy CreateFormGroup rules). Use
   * `$control.width` (100|66|50|33|25) on the schema for explicit overrides.
   */
  columns?: 1 | 2 | 3 | 4;
}

export interface AutoFormAction {
  label: string;
  icon?: string;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  onClick: () => void | Promise<void>;
  disabled?: boolean;
}

export interface AutoFormProps<T extends TObject> {
  form: FormModel<T>;

  /** Header icon (lucide name). */
  icon?: string;
  /** Header title. */
  title?: string;
  /** Header description / subtitle. */
  description?: string;

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

  /** Per-field control overrides keyed by field name (also works without groups). */
  fields?: Partial<
    Record<keyof T["properties"] & string, Partial<Omit<ControlProps, "input">>>
  >;

  /** Submit button label. */
  submitLabel?: string;
  /** Hide built-in submit button. */
  noSubmit?: boolean;
  /** Disable submit when form is pristine (not dirty). */
  disabledIfPristine?: boolean;
  /** Disable the entire form (cascades to controls). */
  disabled?: boolean;

  /** Cancel button — hidden when omitted. */
  onCancel?: () => void;
  /** Skip the reset button in the bottom bar. */
  skipReset?: boolean;
  /** Skip the entire bottom bar. */
  skipBottomBar?: boolean;

  /** Extra action buttons in the bottom bar (left side). */
  actions?: AutoFormAction[];

  /** Extra content rendered above the bottom bar. */
  footer?: ReactNode;

  /** Throttle (ms) for text inputs. Propagated to every Control. */
  throttle?: number;

  className?: string;
}

/**
 * Schema-driven form with optional grouping, header chrome, and bottom
 * bar. Every input field is resolved through `<Control>`, so schemas
 * carrying `$control` metadata configure themselves.
 */
export function AutoForm<T extends TObject>(props: AutoFormProps<T>) {
  const { dirty } = useFormState(props.form, ["dirty"]);
  const inputs = props.form.input as Record<string, never>;
  const schema =
    (props.form.options.schema as TObject) ??
    ({
      properties: {},
    } as TObject);

  const resolvedGroups: AutoFormGroup[] = useMemo(() => {
    if (props.groups) return props.groups.filter((g) => g.can?.() !== false);
    if (props.autoGroup) {
      const opts = typeof props.autoGroup === "object" ? props.autoGroup : {};
      return autoGroupSchema(schema, opts);
    }
    return [
      {
        fields: Object.keys(schema.properties ?? {}),
      },
    ];
  }, [props.groups, props.autoGroup, schema]);

  const HeaderIcon = props.icon ? iconFor(props.icon) : undefined;

  return (
    <form {...props.form.props} className={props.className}>
      <div className="flex flex-col gap-4">
        {(props.title || props.description || HeaderIcon) && (
          <div className="bg-muted/40 border rounded-md p-4 flex items-start gap-3">
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
          </div>
        )}

        {resolvedGroups.map((group, gi) => (
          <GroupBlock
            key={gi}
            group={group}
            inputs={inputs}
            disabled={props.disabled}
            throttle={props.throttle}
            fields={props.fields}
            multiGroup={resolvedGroups.length > 1}
          />
        ))}

        {props.footer}

        {!props.skipBottomBar && (
          <BottomBar
            form={props.form}
            dirty={dirty}
            disabled={props.disabled}
            disabledIfPristine={props.disabledIfPristine}
            submitLabel={props.submitLabel}
            noSubmit={props.noSubmit}
            onCancel={props.onCancel}
            skipReset={props.skipReset}
            actions={props.actions}
          />
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
  disabled?: boolean;
  throttle?: number;
  multiGroup?: boolean;
}

function GroupBlock(props: GroupBlockProps) {
  const { group } = props;
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
      return { name, input, props: merged };
    })
    .filter(Boolean) as Array<{
    name: string;
    input: BaseInputField;
    props: Partial<ControlProps>;
  }>;

  if (!items.length && !props.multiGroup) return null;

  // Naked group: no title, no icon → no card chrome (lets solo complex
  // fields render with just their own header).
  const isNaked = !group.title && !Icon;
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
      <div className={`grid gap-3 grid-cols-12 ${isNaked ? "" : "p-3"}`}>
        {items.map((it) => (
          <div
            key={it.name}
            className={spanClass(
              widthFor(it.input, it.props.width as number | undefined),
            )}
          >
            <Control
              input={it.input}
              {...it.props}
              disabled={props.disabled || it.props.disabled}
              throttle={it.props.throttle ?? props.throttle}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────

interface BottomBarProps {
  form: FormModel<TObject>;
  dirty?: boolean;
  disabled?: boolean;
  disabledIfPristine?: boolean;
  submitLabel?: string;
  noSubmit?: boolean;
  onCancel?: () => void;
  skipReset?: boolean;
  actions?: AutoFormAction[];
}

function BottomBar(props: BottomBarProps) {
  return (
    <div className="bg-card flex items-center gap-2 border rounded-md p-2">
      {props.onCancel && (
        <Button
          type="button"
          variant="ghost"
          onClick={props.onCancel}
          disabled={props.disabled}
        >
          <X className="size-4 mr-1" />
          Cancel
        </Button>
      )}
      {!props.skipReset && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => props.form.reset()}
          disabled={props.disabled || !props.dirty}
        >
          <RotateCcw className="size-4 mr-1" />
          Reset
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
            {Icon && <Icon className="size-4 mr-1" />}
            {action.label}
          </Button>
        );
      })}

      <div className="ml-auto flex items-center gap-2">
        <FormErrorPopover form={props.form} />
        {!props.noSubmit && (
          <Button
            type="submit"
            disabled={
              props.disabled ||
              props.form.submitting ||
              (props.disabledIfPristine && !props.dirty)
            }
          >
            {props.submitLabel ?? "Save"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────

interface FormErrorPopoverProps {
  form: FormModel<TObject>;
}

function FormErrorPopover(props: FormErrorPopoverProps) {
  const { error } = useFormState(props.form, ["error"]);
  const [open, setOpen] = useState(false);
  // close popover when error clears
  useEffect(() => {
    if (!error && open) setOpen(false);
  }, [error, open]);

  if (!error) return null;

  const items = collectErrors(error);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Form errors"
          className="text-destructive"
        >
          <AlertCircle className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <p className="text-destructive text-sm font-medium px-2 py-1">
          {items.length === 1 ? "Error" : "Errors"}
        </p>
        <ul className="flex flex-col gap-1">
          {items.map((it, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => focusError(it.path, props.form.id)}
                className="hover:bg-accent w-full rounded text-left text-xs px-2 py-1"
              >
                <span className="font-medium">{it.path || "Form"}</span>
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
  schema: TObject,
  opts: { defaultTitle?: string; defaultIcon?: string },
): AutoFormGroup[] => {
  const general: AutoFormGroup = {
    title: opts.defaultTitle ?? "General",
    icon: opts.defaultIcon ?? "cog",
    fields: [],
  };
  const groups: AutoFormGroup[] = [];

  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const p = prop as { type?: string; items?: { type?: string } };
    const isObject = p.type === "object";
    const isArrayOfObjects = p.type === "array" && p.items?.type === "object";
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
