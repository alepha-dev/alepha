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
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { FormField } from "@/registry/default/control-base/form-field";

export type SelectOption = string | { value: string; label: string };

type LoaderMode = "static" | "short" | "long";

export interface ControlSelectProps {
  input: BaseInputField;
  label?: string;
  description?: string;
  segmented?: boolean;
  combobox?: boolean;
  loader?: (search: string, resolve?: string[]) => Async<SelectOption[]>;
  loaderThreshold?: number;
  loaderDebounce?: number;
}

const optValue = (o: SelectOption) => (typeof o === "string" ? o : o.value);
const optLabel = (o: SelectOption) => (typeof o === "string" ? o : o.label);

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

  const enumValues = (meta.enum as SelectOption[] | undefined) ?? [];

  const {
    data: asyncData,
    loading,
    mode,
    search,
  } = useAsyncLoader(
    props.loader,
    props.loaderThreshold ?? 100,
    props.loaderDebounce ?? 300,
    props.input.initialValue,
  );

  const [staticData, setStaticData] = useState<SelectOption[]>([]);
  const enumKey = JSON.stringify(enumValues);
  useEffect(() => {
    if (props.loader) return;
    if (isBoolean && enumValues.length === 0) {
      setStaticData([
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ]);
    } else {
      setStaticData(enumValues);
    }
  }, [props.loader, enumKey, isBoolean]);

  const data = props.loader ? asyncData : staticData;

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
        <ToggleGroup
          type="single"
          value={value != null ? String(value) : ""}
          onValueChange={(v) => v && setValue(coerce(v))}
        >
          {data.slice(0, 10).map((o) => (
            <ToggleGroupItem key={optValue(o)} value={optValue(o)}>
              {optLabel(o)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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
          value={value}
          onChange={(v) => setValue(v)}
          coerce={coerce}
          onSearch={mode === "long" ? search.run : undefined}
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
      >
        <SelectTrigger id={meta.id}>
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
  value: unknown;
  onChange: (v: unknown) => void;
  coerce: (v: string) => unknown;
  onSearch?: (q: string) => void;
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
                <CommandEmpty>No results.</CommandEmpty>
                <CommandGroup>
                  {props.data.map((o) => {
                    const v = optValue(o);
                    const isSelected = selected.includes(v);
                    return (
                      <CommandItem
                        key={v}
                        value={v}
                        onSelect={() => handleSelect(v)}
                      >
                        <Check
                          className={cn(
                            "mr-2 size-4",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {optLabel(o)}
                      </CommandItem>
                    );
                  })}
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
