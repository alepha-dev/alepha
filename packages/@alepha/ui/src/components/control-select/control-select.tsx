import { FormField } from "@alepha/ui/components/control-base/form-field";
import { Button } from "@alepha/ui/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@alepha/ui/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alepha/ui/components/ui/popover";
import { Segmented } from "@alepha/ui/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alepha/ui/components/ui/select";
import { cn } from "@alepha/ui/lib/utils";
import type { Async } from "alepha";
import { useAction } from "alepha/react";
import {
  type BaseInputField,
  parseField,
  useFieldValue,
  useFormState,
} from "alepha/react/form";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type SelectOption =
  | string
  | {
      value: string;
      label: string;
      /**
       * Optional secondary line shown under the label in the dropdown.
       */
      description?: string;
      /**
       * Optional small badge rendered next to the label.
       */
      tag?: string;
    };

type LoaderMode = "static" | "short" | "long";

export interface ControlSelectProps {
  /**
   * Bound `InputField` from `useForm`. Single or multi value depending on schema.
   */
  input: BaseInputField;
  /**
   * Field label. Falls back to schema `title`.
   */
  label?: string;
  /**
   * Helper text shown below the input.
   */
  description?: string;
  /**
   * Render as a `<Segmented>` control (best for 2–4 options).
   */
  segmented?: boolean;
  /**
   * Render as a searchable combobox instead of a native select.
   */
  combobox?: boolean;
  /**
   * Async option loader. Triggers long-mode (server-side search) above `loaderThreshold` options.
   */
  loader?: (search: string, resolve?: string[]) => Async<SelectOption[]>;
  /**
   * Option count above which `loader` is invoked on every search instead of once. Defaults to ~50.
   */
  loaderThreshold?: number;
  /**
   * Debounce in ms applied to search queries when calling `loader` in long mode.
   */
  loaderDebounce?: number;
  /**
   * Disable the control.
   */
  disabled?: boolean;
  /**
   * Inline option list (overrides schema `enum`). Accepts either a static
   * array or an async function `(query) => SelectOption[]`. The async form
   * is mapped to a long-mode loader.
   */
  items?:
    | SelectOption[]
    | ((query: string) => SelectOption[] | Promise<SelectOption[]>);
  /**
   * Allow the user to add a new option by typing. When `true`, the typed
   * query becomes the value (and label) of a freshly created entry. When a
   * function, the function builds the option from the query.
   *
   * - For multi-select fields: each entry is appended to the value array.
   * - For single fields: behaves like a regular text input with a dropdown
   *   suggesting existing options.
   */
  createNewEntry?: boolean | ((query: string) => Exclude<SelectOption, string>);
}

const optValue = (o: SelectOption) => (typeof o === "string" ? o : o.value);
const optLabel = (o: SelectOption) => (typeof o === "string" ? o : o.label);
const optDesc = (o: SelectOption) =>
  typeof o === "string" ? undefined : o.description;
const optTag = (o: SelectOption) => (typeof o === "string" ? undefined : o.tag);

export function ControlSelect(props: ControlSelectProps) {
  const form = useFormState(props.input, ["error"]);
  const [value, setValue] = useFieldValue(props.input);

  const meta = parseField(props.input, {
    label: props.label,
    description: props.description,
    error: form.error,
  });

  const isArray = meta.isArray;
  const isNumeric = meta.type === "number" || meta.type === "integer";
  const isBoolean = meta.type === "boolean";

  // Normalize items prop: array → static; function → loader
  const itemsArray = Array.isArray(props.items)
    ? (props.items as SelectOption[])
    : undefined;
  const itemsLoader =
    typeof props.items === "function"
      ? (props.items as (q: string) => Async<SelectOption[]>)
      : undefined;

  const enumValues =
    itemsArray ?? (meta.enum as SelectOption[] | undefined) ?? [];

  const effectiveLoader = props.loader ?? itemsLoader;

  const {
    data: asyncData,
    loading,
    mode,
    search,
  } = useAsyncLoader(
    effectiveLoader,
    props.loaderThreshold ?? 100,
    props.loaderDebounce ?? 300,
    props.input.initialValue,
  );

  const [staticData, setStaticData] = useState<SelectOption[]>([]);
  const enumKey = JSON.stringify(enumValues);
  const min = meta.constraints.minimum;
  const max = meta.constraints.maximum;
  useEffect(() => {
    if (effectiveLoader) return;
    if (isBoolean && enumValues.length === 0) {
      setStaticData([
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ]);
    } else if (
      isNumeric &&
      enumValues.length === 0 &&
      typeof min === "number" &&
      typeof max === "number" &&
      max - min <= 20
    ) {
      const range: SelectOption[] = [];
      for (let i = min; i <= max; i++) range.push(String(i));
      setStaticData(range);
    } else {
      setStaticData(enumValues);
    }
  }, [effectiveLoader, enumKey, isBoolean, isNumeric, min, max]);

  const data = effectiveLoader ? asyncData : staticData;

  if (!props.input?.props) return null;

  const coerce = (raw: string): unknown => {
    if (isNumeric) return Number(raw);
    if (isBoolean) return raw === "true";
    return raw;
  };

  if (props.segmented) {
    return (
      <FormField
        id={meta.id}
        label={meta.label}
        description={meta.description}
        error={meta.error}
        required={meta.required}
      >
        <Segmented
          value={value != null ? String(value) : undefined}
          onChange={(v) => setValue(coerce(v))}
          disabled={props.disabled}
          options={data.slice(0, 10).map((o) => ({
            value: optValue(o),
            label: optLabel(o),
          }))}
          fullWidth
        />
      </FormField>
    );
  }

  // Async loader, multi-select, explicit combobox, or many items → Combobox
  if (isArray || props.combobox || mode === "long" || data.length > 20) {
    return (
      <FormField
        id={meta.id}
        label={meta.label}
        description={meta.description}
        error={meta.error}
        required={meta.required}
      >
        <Combobox
          id={meta.id}
          data={data}
          loading={loading}
          multi={isArray}
          disabled={props.disabled}
          value={value}
          onChange={(v) => setValue(v)}
          coerce={coerce}
          onSearch={mode === "long" ? search.run : undefined}
          createNewEntry={props.createNewEntry}
        />
      </FormField>
    );
  }

  // Static / short — native Select
  return (
    <FormField
      id={meta.id}
      label={meta.label}
      description={meta.description}
      error={meta.error}
      required={meta.required}
    >
      <Select
        value={value != null ? String(value) : undefined}
        onValueChange={(v) => setValue(coerce(v))}
        disabled={props.disabled}
      >
        <SelectTrigger id={meta.id} className="w-full">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {data.map((o) => (
            <SelectItem key={optValue(o)} value={optValue(o)}>
              {optLabel(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

interface ComboboxProps {
  id?: string;
  data: SelectOption[];
  loading: boolean;
  multi: boolean;
  disabled?: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
  coerce: (v: string) => unknown;
  onSearch?: (q: string) => void;
  createNewEntry?: ControlSelectProps["createNewEntry"];
}

function Combobox(props: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected: string[] = props.multi
    ? Array.isArray(props.value)
      ? (props.value as unknown[]).map(String)
      : []
    : props.value != null
      ? [String(props.value)]
      : [];

  const labelFor = (val: string) => {
    const found = props.data.find((o) => optValue(o) === val);
    return found ? optLabel(found) : val;
  };

  const triggerLabel = props.multi
    ? selected.length === 0
      ? "Select…"
      : selected.length <= 2
        ? selected.map(labelFor).join(", ")
        : `${selected.length} selected`
    : selected[0]
      ? labelFor(selected[0])
      : "Select…";

  const handleSelect = (raw: string) => {
    if (props.multi) {
      const next = selected.includes(raw)
        ? selected.filter((v) => v !== raw)
        : [...selected, raw];
      props.onChange(next.map(props.coerce));
    } else {
      props.onChange(props.coerce(raw));
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={props.id}
          variant="outline"
          disabled={props.disabled}
          className={cn(
            "w-full justify-between font-normal",
            selected.length === 0 && "text-muted-foreground",
          )}
        >
          {triggerLabel}
          <ChevronsUpDown className="ml-2 size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder="Search…"
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              props.onSearch?.(v);
            }}
          />
          <CommandList>
            {props.loading ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 p-4 text-sm">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {props.createNewEntry ? "" : "No results."}
                </CommandEmpty>
                <CommandGroup>
                  {props.data.map((o) => {
                    const v = optValue(o);
                    const isSelected = selected.includes(v);
                    const desc = optDesc(o);
                    const tag = optTag(o);
                    return (
                      <CommandItem
                        key={v}
                        value={v}
                        onSelect={() => handleSelect(v)}
                      >
                        <Check
                          className={cn(
                            "mr-2 size-4 shrink-0",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {tag && (
                              <span className="bg-muted text-muted-foreground rounded px-1 text-[10px] uppercase tracking-wide">
                                {tag}
                              </span>
                            )}
                            <span className="truncate">{optLabel(o)}</span>
                          </div>
                          {desc && (
                            <span className="text-muted-foreground text-xs truncate">
                              {desc}
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                  {props.createNewEntry &&
                    query &&
                    !props.data.some((o) => optValue(o) === query) && (
                      <CommandItem
                        value={`__create__${query}`}
                        onSelect={() => {
                          const built =
                            typeof props.createNewEntry === "function"
                              ? props.createNewEntry(query)
                              : { value: query, label: query };
                          handleSelect(built.value);
                          setQuery("");
                        }}
                      >
                        <span className="mr-2">+</span>
                        Create "{query}"
                      </CommandItem>
                    )}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const useAsyncLoader = (
  loader: ControlSelectProps["loader"],
  threshold: number,
  debounceMs: number,
  defaultValue: unknown,
) => {
  const [data, setData] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoaderMode>("static");
  const cache = useRef(new Map<string, SelectOption[]>());

  useAction(
    {
      name: "select:loader:init",
      runOnInit: true,
      handler: async () => {
        if (!loader) {
          setMode("static");
          return;
        }
        setLoading(true);
        try {
          const result = await loader("");
          const isShort = result.length <= threshold;
          setMode(isShort ? "short" : "long");
          cache.current.set("", result);
          setData(result);

          if (!isShort && defaultValue != null && String(defaultValue) !== "") {
            const resolved = await loader("", [String(defaultValue)]);
            if (resolved.length > 0) {
              setData((prev) => {
                const existing = new Set(prev.map(optValue));
                const fresh = resolved.filter(
                  (r) => !existing.has(optValue(r)),
                );
                return [...prev, ...fresh];
              });
            }
          }
        } finally {
          setLoading(false);
        }
      },
    },
    [loader, threshold],
  );

  const search = useAction<[string]>(
    {
      debounce: debounceMs,
      handler: async (text) => {
        if (!loader || mode !== "long") return;
        if (cache.current.has(text)) {
          setData(cache.current.get(text)!);
          return;
        }
        setLoading(true);
        try {
          const result = await loader(text);
          cache.current.set(text, result);
          setData(result);
        } finally {
          setLoading(false);
        }
      },
    },
    [loader, mode, debounceMs],
  );

  return { data, loading, mode, search };
};
