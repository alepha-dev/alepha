import * as React from "react";

void React;

import {
  ControlArray,
  type ControlArrayProps,
} from "@alepha/ui/components/control-array/control-array";
import {
  FormField,
  formFieldAriaProps,
  useFormFieldAutoSave,
} from "@alepha/ui/components/control-base/form-field";
import {
  type IconComponent,
  iconFor,
} from "@alepha/ui/components/control-base/icon-hint";
import { ControlDate } from "@alepha/ui/components/control-date/control-date";
import { ControlNumber } from "@alepha/ui/components/control-number/control-number";
import { ControlObject } from "@alepha/ui/components/control-object/control-object";
import { ControlPassword } from "@alepha/ui/components/control-password/control-password";
import {
  ControlSelect,
  type SelectOption,
} from "@alepha/ui/components/control-select/control-select";
import {
  ControlUpload,
  type ControlUploadProps,
} from "@alepha/ui/components/control-upload/control-upload";
import { Input } from "@alepha/ui/components/ui/input";
import { Switch } from "@alepha/ui/components/ui/switch";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import { z } from "alepha";
import { useAlepha } from "alepha/react";
import {
  type BaseInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";
import { resolveSchemaControl, type SchemaControl } from "alepha/react/ui";
import { Check, X } from "lucide-react";
import {
  type ComponentType,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useState,
} from "react";

export interface ControlProps {
  /**
   * Bound `InputField` from `useForm`. Carries value, schema, and error state.
   */
  input: BaseInputField;
  /**
   * Field label. Falls back to schema `title` or the field name.
   */
  label?: string;
  /**
   * Helper text shown below the control. Falls back to schema `description`.
   */
  description?: string;
  /**
   * Force a specific input variant — renders a single-line text input.
   */
  text?: boolean;
  /**
   * Force a textarea.
   */
  area?: boolean;
  /**
   * Force a masked password input.
   */
  password?: boolean;
  /**
   * Force a `<Switch>` (boolean toggle).
   */
  switch?: boolean;
  /**
   * Force a numeric input.
   */
  number?: boolean;
  /**
   * Force the file-upload control (alias for `upload`).
   */
  file?: boolean;
  /**
   * Force a date picker.
   */
  date?: boolean;
  /**
   * Force a date-time picker.
   */
  datetime?: boolean;
  /**
   * Force a time picker.
   */
  time?: boolean;
  /**
   * Force a `<Select>`.
   */
  select?: boolean;
  /**
   * Force a combobox (searchable select). Alias for `searchable: true`.
   */
  combobox?: boolean;
  /**
   * Force the select's search input on or off. Defaults to "auto" — on above
   * ~20 options, off below.
   */
  searchable?: boolean;
  /**
   * Force a `<Segmented>` control (one option visible at a time).
   */
  segmented?: boolean;
  /**
   * Force a slider (numeric only).
   */
  slider?: boolean;
  /**
   * Force a nested `<ControlObject>` for object-typed schemas.
   */
  object?: boolean;
  /**
   * Force a nested `<ControlArray>` for array-typed schemas.
   */
  array?: boolean;
  /**
   * Props forwarded to the nested `<ControlObject>`, keyed by child field name.
   * This is the only way to reach INSIDE an object field — without it a caller
   * can style/override the object as a whole but never one of its children
   * (e.g. attaching a `custom` widget to `payg.zoneFareCents`).
   */
  /**
   * Dictionary prefix for schema-generated labels/help: this field reads
   * `<prefix>.<name>` and `<prefix>.<name>.desc`, and passes the extended
   * prefix down into nested objects and array items.
   */
  i18nPrefix?: string;
  objectProps?: {
    controlProps?: Record<string, Partial<Omit<ControlProps, "input">>>;
    variant?: "fieldset" | "plain";
    defaultExpanded?: boolean;
  };
  /**
   * Custom render component receiving `{value, onChange}`.
   */
  custom?: ComponentType<{ value: unknown; onChange: (v: unknown) => void }>;
  /**
   * Override icon — pass `null` to remove the schema-inferred icon.
   */
  icon?: IconComponent | string | null;
  /**
   * Disable the control.
   */
  disabled?: boolean;
  /**
   * Render slot before the control.
   */
  top?: ReactNode;
  /**
   * Render slot after the control.
   */
  bottom?: ReactNode;
  /**
   * Width slot inside an `<AutoForm>` group (mapped to a CSS grid column
   * span). Read by the parent group; ignored when rendering standalone.
   */
  width?: 100 | 75 | 66 | 50 | 33 | 25;
  /**
   * HTML `autocomplete` hint passed to the underlying input.
   */
  autoComplete?: string;
  /**
   * HTML `placeholder` passed to the underlying input.
   */
  placeholder?: string;
  /**
   * Autofocus the control on mount. Forwarded to the text input,
   * textarea, or password input the control renders.
   */
  autoFocus?: boolean;
  /**
   * Visible row count for the textarea variant. Overrides the value
   * auto-derived from the schema's `maxLength`. Ignored by other variants.
   */
  rows?: number;
  /**
   * Escape hatch — extra native attributes (event handlers, `className`,
   * `aria-*`, `style`, …) forwarded to whichever element the control
   * actually renders (text input / textarea / password input). The form
   * bindings (`value`, `onChange`, `id`, `name`) always win and cannot be
   * overridden here.
   */
  inputProps?: HTMLAttributes<HTMLElement>;
  /**
   * Allow user to create new entries in select / multi-select.
   */
  createNewEntry?: boolean | ((query: string) => unknown);
  /**
   * Inline option list for select / combobox controls. Infer array or
   * async loader. Overrides schema-derived `enum` when present.
   */
  items?:
    | SelectOption[]
    | ((query: string) => SelectOption[] | Promise<SelectOption[]>);
  /**
   * Forwarded to `ControlSelect` — adds a synthetic "none" row that
   * resets the field to `undefined`. Use for optional filter chips.
   */
  clearable?: boolean;
  /**
   * Forwarded to `ControlSelect` — label of the `clearable` row, also
   * used as the empty-state trigger placeholder. Defaults to "None".
   */
  clearLabel?: string;
  /**
   * Forwarded to `ControlSelect` — extra className on the trigger.
   * Useful for sizing filter chips inline.
   */
  triggerClassName?: string;
  /**
   * Render a managed upload control (image preview, multi, drag-drop)
   * that calls `FileController.uploadFile` and stores the file ID(s) in
   * the form value. Pass `true` for defaults or an options object.
   */
  upload?:
    | boolean
    | Pick<
        ControlUploadProps,
        "multi" | "accept" | "maxSize" | "bucket" | "image"
      >;
}

/**
 * Schema-driven form field renderer. Inspects the bound `InputField` from
 * `useForm`, evaluates `schema.$control` (object or function), merges the
 * result with explicit props, and dispatches to the right sub-control.
 */
export function Control(props: ControlProps) {
  const form = useFormState(props.input, ["error", "dirty"]);
  const autoSaveEnabled = useFormFieldAutoSave();
  const [value, setValue] = useFieldValue(props.input);

  // Function-form `$control` reads other fields → re-render on any
  // change. Infer `$control` (object) does not need this subscription.
  useDynamicControlRefresh(props.input);

  if (!props.input?.props) return null;

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  // ── Resolve $control (object | function | false) ─────────────────
  const resolved = resolveSchemaControl(meta.control, {
    form: props.input.form,
    value,
  });
  if (resolved === null) return null;

  const merged = {
    ...props,
    ...(resolved as Partial<ControlProps>),
  } as ControlProps & Partial<SchemaControl>;

  // ── Custom escape hatch ──────────────────────────────────────────
  if (merged.custom) {
    const Custom = merged.custom;
    return wrapWithSlots(
      merged,
      <FormField
        id={meta.id}
        label={merged.label ?? meta.label}
        description={merged.description ?? meta.description}
        error={meta.error}
        required={meta.required}
      >
        <Custom value={value} onChange={(v) => setValue(v)} />
      </FormField>,
    );
  }

  // ── Recursive: object / array of objects ─────────────────────────
  if (merged.object || meta.isObject) {
    return wrapWithSlots(
      merged,
      <ControlObject
        input={props.input}
        label={merged.label ?? props.label}
        description={merged.description ?? props.description}
        disabled={merged.disabled}
        i18nPrefix={merged.i18nPrefix}
        controlProps={merged.objectProps?.controlProps}
        variant={merged.objectProps?.variant}
        defaultExpanded={merged.objectProps?.defaultExpanded}
      />,
    );
  }
  if (merged.array || meta.isArrayOfObjects) {
    const arrayProps = (merged as { arrayProps?: Record<string, unknown> })
      .arrayProps;
    return wrapWithSlots(
      merged,
      <ControlArray
        input={props.input}
        i18nPrefix={merged.i18nPrefix}
        label={merged.label ?? props.label}
        description={merged.description ?? props.description}
        disabled={merged.disabled}
        confirmDelete={
          arrayProps?.confirmDelete as ControlArrayProps["confirmDelete"]
        }
        renderTabName={
          arrayProps?.renderTabName as ControlArrayProps["renderTabName"]
        }
        forceTabs={arrayProps?.forceTabs as boolean | undefined}
      />,
    );
  }

  // ── File: managed upload (image preview, multi, drag-drop) ──────
  // Checked early so it wins over the array→combobox branch below
  // when the schema is `z.array(z.string())` with $control.upload.
  if (merged.upload) {
    const uploadOpts =
      typeof merged.upload === "object"
        ? (merged.upload as Partial<ControlUploadProps>)
        : {};
    return wrapWithSlots(
      merged,
      <ControlUpload
        input={props.input}
        label={merged.label ?? props.label}
        description={merged.description ?? props.description}
        disabled={merged.disabled}
        {...uploadOpts}
      />,
    );
  }

  // ── Number / slider ──────────────────────────────────────────────
  if (
    merged.slider ||
    merged.number ||
    (!merged.select &&
      !merged.segmented &&
      !merged.combobox &&
      (meta.type === "number" || meta.type === "integer"))
  ) {
    return wrapWithSlots(
      merged,
      <ControlNumber
        input={props.input}
        label={merged.label ?? props.label}
        description={merged.description ?? props.description}
        slider={merged.slider}
        disabled={merged.disabled}
      />,
    );
  }

  // ── Items provided → select / multi / combobox ───────────────────
  const items = (merged as Record<string, unknown>).items as
    | undefined
    | unknown[]
    | ((q: string) => unknown);
  if (
    merged.select ||
    merged.combobox ||
    merged.segmented ||
    meta.isEnum ||
    (meta.isArray && !meta.isArrayOfObjects) ||
    items != null
  ) {
    return wrapWithSlots(
      merged,
      <ControlSelect
        input={props.input}
        label={merged.label ?? props.label}
        description={merged.description ?? props.description}
        segmented={merged.segmented}
        combobox={merged.combobox}
        searchable={merged.searchable}
        items={items as never}
        icon={resolveIcon(merged.icon)}
        disabled={merged.disabled}
        createNewEntry={
          merged.createNewEntry as boolean | ((q: string) => never) | undefined
        }
        clearable={merged.clearable}
        clearLabel={merged.clearLabel}
        triggerClassName={merged.triggerClassName}
      />,
    );
  }

  // ── Boolean → switch ─────────────────────────────────────────────
  if (meta.type === "boolean" && merged.switch !== false) {
    return wrapWithSlots(
      merged,
      <FormField
        id={meta.id}
        label={merged.label ?? meta.label}
        description={merged.description ?? meta.description}
        error={meta.error}
        required={meta.required}
      >
        <div className="flex h-9 items-center">
          <Switch
            id={meta.id}
            // Same omission as the numeric control had: without a name the
            // toggle is invisible to `[name="…"]` lookups, including
            // `AutoForm`'s scroll-to-first-error.
            name={props.input.props.name}
            disabled={merged.disabled}
            checked={Boolean(value)}
            onCheckedChange={(v) => setValue(v)}
          />
        </div>
      </FormField>,
    );
  }

  // ── Date / time ──────────────────────────────────────────────────
  if (
    merged.date ||
    merged.datetime ||
    merged.time ||
    meta.format === "date" ||
    meta.format === "date-time" ||
    meta.format === "time"
  ) {
    return wrapWithSlots(
      merged,
      <ControlDate
        input={props.input}
        label={merged.label ?? props.label}
        description={merged.description ?? props.description}
        date={merged.date}
        datetime={merged.datetime}
        time={merged.time}
        disabled={merged.disabled}
      />,
    );
  }

  // ── File (raw) ───────────────────────────────────────────────────
  if (merged.file) {
    return wrapWithSlots(
      merged,
      <FormField
        id={meta.id}
        label={merged.label ?? meta.label}
        description={merged.description ?? meta.description}
        error={meta.error}
        required={meta.required}
      >
        <Input
          id={meta.id}
          name={props.input.props.name}
          type="file"
          disabled={merged.disabled}
          onChange={(e) => setValue(e.target.files?.[0])}
        />
      </FormField>,
    );
  }

  // ── Auto-textarea: explicit `area` or maxLength > 256 ────────────
  const maxLength = meta.constraints.maxLength ?? 0;
  if (merged.area || maxLength > 256) {
    const rows =
      merged.rows ?? (maxLength > 1024 ? 6 : maxLength > 512 ? 4 : 2);
    return wrapWithSlots(
      merged,
      <FormField
        id={meta.id}
        label={merged.label ?? meta.label}
        description={merged.description ?? meta.description}
        error={meta.error}
        required={meta.required}
      >
        <Textarea
          {...merged.inputProps}
          {...formFieldAriaProps({
            id: meta.id,
            error: meta.error,
            description: merged.description ?? meta.description,
          })}
          id={meta.id}
          name={props.input.props.name}
          rows={rows}
          disabled={merged.disabled}
          maxLength={maxLength || undefined}
          autoComplete={merged.autoComplete}
          autoFocus={merged.autoFocus}
          placeholder={merged.placeholder}
          value={String(value ?? "")}
          onChange={(e) => setValue(e.target.value)}
        />
      </FormField>,
    );
  }

  // ── Password ─────────────────────────────────────────────────────
  const isPassword =
    merged.password ||
    meta.iconHint === "password" ||
    meta.format === "password";
  if (isPassword) {
    return wrapWithSlots(
      merged,
      <ControlPassword
        id={meta.id}
        name={props.input.props.name}
        label={merged.label ?? meta.label}
        description={merged.description ?? meta.description}
        error={meta.error}
        required={meta.required}
        disabled={merged.disabled}
        autoComplete={merged.autoComplete}
        autoFocus={merged.autoFocus}
        inputProps={merged.inputProps}
        icon={resolveIcon(merged.icon, "password")}
        value={String(value ?? "")}
        onChange={(v) => setValue(v)}
      />,
    );
  }

  // ── Default text input with format-driven HTML5 type + icon ──────
  const Icon = resolveIcon(merged.icon, meta.iconHint);
  const htmlType =
    meta.format === "email"
      ? "email"
      : meta.format === "url" || meta.format === "uri"
        ? "url"
        : meta.format === "tel" || meta.format === "phone"
          ? "tel"
          : "text";

  // Derive a sensible HTML `autocomplete` hint from the schema format so
  // password managers and browser autofill behave correctly out of the box.
  // Explicit `autoComplete` prop always wins.
  const autoCompleteFromFormat =
    meta.format === "email"
      ? "email"
      : meta.format === "tel" || meta.format === "phone"
        ? "tel"
        : meta.format === "url" || meta.format === "uri"
          ? "url"
          : undefined;
  const autoComplete = merged.autoComplete ?? autoCompleteFromFormat;

  // ── Right-side affordance: tick (when dirty) or clear (when nullable) ─
  // Tick only renders inside an `<AutoForm autoSave>` tree (or any caller
  // that explicitly wraps with `<FormFieldAutoSaveProvider value>`).
  const showSave = autoSaveEnabled && !!form.dirty && !merged.disabled;
  const isNullable =
    !meta.required && value != null && value !== "" && !merged.disabled;
  const showClear = !showSave && isNullable;
  // Reserve a fixed right gutter for any editable field so the tick/clear
  // can swap in without nudging the input width.
  const reserveGutter = !merged.disabled;

  return wrapWithSlots(
    merged,
    <FormField
      id={meta.id}
      label={merged.label ?? meta.label}
      description={merged.description ?? meta.description}
      error={meta.error}
      required={meta.required}
    >
      <div className="relative">
        {Icon && (
          <Icon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2 pointer-events-none" />
        )}
        <Input
          {...merged.inputProps}
          {...formFieldAriaProps({
            id: meta.id,
            error: meta.error,
            description: merged.description ?? meta.description,
          })}
          id={meta.id}
          name={props.input.props.name}
          type={htmlType}
          disabled={merged.disabled}
          autoComplete={autoComplete}
          autoFocus={merged.autoFocus}
          placeholder={merged.placeholder}
          value={String(value ?? "")}
          minLength={meta.constraints.minLength}
          maxLength={meta.constraints.maxLength}
          pattern={meta.constraints.pattern}
          className={[
            merged.inputProps?.className,
            (Icon ? "pl-9" : "") + (reserveGutter ? " pr-9" : ""),
          ]
            .filter(Boolean)
            .join(" ")}
          onChange={(e) => setValue(e.target.value)}
        />
        {showSave && (
          <button
            type="button"
            onClick={() => props.input.form.submit()}
            aria-label="Save"
            className="text-primary hover:text-primary/80 absolute top-1/2 right-2 -translate-y-1/2 p-1"
          >
            <Check className="size-3.5" />
          </button>
        )}
        {showClear && (
          <button
            type="button"
            onClick={() => setValue(undefined)}
            aria-label="Clear"
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 p-1"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </FormField>,
  );
}

const useDynamicControlRefresh = (input: BaseInputField | undefined) => {
  const alepha = useAlepha();
  const [, bump] = useState(0);
  // Function-form `$control` rides on zod's `.meta()` registry (not a plain
  // schema property), and the field may be wrapped (optional/nullable), so peel
  // to the inner schema before reading its meta to detect the dynamic case.
  const base = input?.schema ? z.schema.unwrap(input.schema) : undefined;
  const rawControl = (
    base as { meta?: () => { $control?: unknown } } | undefined
  )?.meta?.()?.$control;
  const isDynamic = typeof rawControl === "function";
  useEffect(() => {
    if (!isDynamic || !input?.form) return;
    const formId = input.form.id;
    return alepha.events.on("form:change", (e) => {
      if (e.id === formId && e.path !== input.path) bump((n) => n + 1);
    });
  }, [alepha, input?.form, input?.path, isDynamic]);
};

const resolveIcon = (
  icon: ControlProps["icon"],
  fallback?: string | null,
): IconComponent | undefined => {
  if (icon === null) return undefined;
  if (typeof icon === "string") return iconFor(icon);
  if (icon) return icon;
  return iconFor(fallback);
};

const wrapWithSlots = (
  props: ControlProps & Partial<SchemaControl>,
  body: ReactNode,
): ReactNode => {
  const top = (props.top as ReactNode) ?? null;
  const bottom = (props.bottom as ReactNode) ?? null;
  if (!top && !bottom) return body;
  return (
    <div className="flex flex-col gap-1">
      {top}
      {body}
      {bottom}
    </div>
  );
};
