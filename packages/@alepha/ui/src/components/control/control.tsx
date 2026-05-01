import { ControlArray } from "@alepha/ui/components/control/control-array";
import { ControlDate } from "@alepha/ui/components/control/control-date";
import { ControlNumber } from "@alepha/ui/components/control/control-number";
import { ControlObject } from "@alepha/ui/components/control/control-object";
import { ControlSelect } from "@alepha/ui/components/control/control-select";
import { FormField } from "@alepha/ui/components/control/form-field";
import {
  type IconComponent,
  iconFor,
} from "@alepha/ui/components/control/icon-hint";
import { Input } from "@alepha/ui/components/ui/input";
import { Switch } from "@alepha/ui/components/ui/switch";
import { Textarea } from "@alepha/ui/components/ui/textarea";
import {
  type BaseInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";
import { Eye, EyeOff } from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";

export interface ControlProps {
  input: BaseInputField;
  label?: string;
  description?: string;
  /** Force a specific input variant. */
  text?: boolean;
  area?: boolean;
  password?: boolean;
  switch?: boolean;
  number?: boolean;
  file?: boolean;
  date?: boolean;
  datetime?: boolean;
  time?: boolean;
  select?: boolean;
  combobox?: boolean;
  segmented?: boolean;
  slider?: boolean;
  object?: boolean;
  array?: boolean;
  /** Custom render component receiving `{value, onChange}`. */
  custom?: ComponentType<{ value: unknown; onChange: (v: unknown) => void }>;
  /** Override icon — pass `null` to remove the schema-inferred icon. */
  icon?: IconComponent | null;
}

/**
 * Schema-driven form field renderer. Inspects the bound `InputField` from
 * `useForm` and dispatches to the appropriate sub-control or primitive.
 */
export function Control(props: ControlProps) {
  const form = useFormState(props.input, ["error"]);
  const [value, setValue] = useFieldValue(props.input);

  if (!props.input?.props) return null;

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  // ── Custom escape hatch ──────────────────────────────────────────
  if (props.custom) {
    const Custom = props.custom;
    return (
      <FormField
        id={meta.id}
        label={meta.label}
        description={meta.description}
        error={meta.error}
        required={meta.required}
      >
        <Custom value={value} onChange={(v) => setValue(v)} />
      </FormField>
    );
  }

  // ── Recursive: object / array of objects ─────────────────────────
  if (props.object || meta.isObject) {
    return (
      <ControlObject
        input={props.input}
        label={props.label}
        description={props.description}
      />
    );
  }
  if (props.array || meta.isArrayOfObjects) {
    return (
      <ControlArray
        input={props.input}
        label={props.label}
        description={props.description}
      />
    );
  }

  // ── Number / slider ──────────────────────────────────────────────
  if (
    props.slider ||
    props.number ||
    (!props.select &&
      !props.segmented &&
      !props.combobox &&
      (meta.type === "number" || meta.type === "integer"))
  ) {
    return (
      <ControlNumber
        input={props.input}
        label={props.label}
        description={props.description}
        slider={props.slider}
      />
    );
  }

  // ── Select-like: enum, primitive array, segmented, combobox ──────
  if (
    props.select ||
    props.combobox ||
    props.segmented ||
    meta.isEnum ||
    (meta.isArray && !meta.isArrayOfObjects)
  ) {
    return (
      <ControlSelect
        input={props.input}
        label={props.label}
        description={props.description}
        segmented={props.segmented}
        combobox={props.combobox}
      />
    );
  }

  // ── Boolean → switch (or select if `select` is forced) ───────────
  if (meta.type === "boolean") {
    if (props.switch !== false) {
      return (
        <FormField
          id={meta.id}
          label={meta.label}
          description={meta.description}
          error={meta.error}
          required={meta.required}
        >
          <Switch
            id={meta.id}
            checked={Boolean(value)}
            onCheckedChange={(v) => setValue(v)}
          />
        </FormField>
      );
    }
  }

  // ── Date / time ──────────────────────────────────────────────────
  if (
    props.date ||
    props.datetime ||
    props.time ||
    meta.format === "date" ||
    meta.format === "date-time" ||
    meta.format === "time"
  ) {
    return (
      <ControlDate
        input={props.input}
        label={props.label}
        description={props.description}
        date={props.date}
        datetime={props.datetime}
        time={props.time}
      />
    );
  }

  // ── File ─────────────────────────────────────────────────────────
  if (props.file) {
    return (
      <FormField
        id={meta.id}
        label={meta.label}
        description={meta.description}
        error={meta.error}
        required={meta.required}
      >
        <Input
          id={meta.id}
          type="file"
          onChange={(e) => setValue(e.target.files?.[0])}
        />
      </FormField>
    );
  }

  // ── Textarea ─────────────────────────────────────────────────────
  if (props.area) {
    return (
      <FormField
        id={meta.id}
        label={meta.label}
        description={meta.description}
        error={meta.error}
        required={meta.required}
      >
        <Textarea
          id={meta.id}
          rows={4}
          value={String(value ?? "")}
          onChange={(e) => setValue(e.target.value)}
        />
      </FormField>
    );
  }

  // ── Password ─────────────────────────────────────────────────────
  const isPassword =
    props.password ||
    meta.iconHint === "password" ||
    meta.format === "password";
  if (isPassword) {
    return (
      <PasswordControl
        id={meta.id}
        label={meta.label}
        description={meta.description}
        error={meta.error}
        required={meta.required}
        icon={
          props.icon === null ? undefined : (props.icon ?? iconFor("password"))
        }
        value={String(value ?? "")}
        onChange={(v) => setValue(v)}
      />
    );
  }

  // ── Default text input with format-driven HTML5 type + icon ──────
  const Icon =
    props.icon === null ? undefined : (props.icon ?? iconFor(meta.iconHint));
  const htmlType =
    meta.format === "email"
      ? "email"
      : meta.format === "url" || meta.format === "uri"
        ? "url"
        : meta.format === "tel" || meta.format === "phone"
          ? "tel"
          : "text";

  return (
    <FormField
      id={meta.id}
      label={meta.label}
      description={meta.description}
      error={meta.error}
      required={meta.required}
    >
      <IconWrap icon={Icon}>
        <Input
          id={meta.id}
          type={htmlType}
          value={String(value ?? "")}
          minLength={meta.constraints.minLength}
          maxLength={meta.constraints.maxLength}
          pattern={meta.constraints.pattern}
          className={Icon ? "pl-9" : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
      </IconWrap>
    </FormField>
  );
}

function IconWrap(props: { icon?: IconComponent; children: ReactNode }) {
  if (!props.icon) return <>{props.children}</>;
  const Icon = props.icon;
  return (
    <div className="relative">
      <Icon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      {props.children}
    </div>
  );
}

interface PasswordControlProps {
  id?: string;
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  icon?: IconComponent;
  value: string;
  onChange: (v: string) => void;
}

function PasswordControl(props: PasswordControlProps) {
  const [reveal, setReveal] = useState(false);
  const Icon = props.icon;
  return (
    <FormField
      id={props.id}
      label={props.label}
      description={props.description}
      error={props.error}
      required={props.required}
    >
      <div className="relative">
        {Icon && (
          <Icon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        )}
        <Input
          id={props.id}
          type={reveal ? "text" : "password"}
          autoComplete="current-password"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className={Icon ? "pr-9 pl-9" : "pr-9"}
        />
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          aria-label={reveal ? "Hide password" : "Show password"}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
        >
          {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </FormField>
  );
}
