import {
  Autocomplete,
  type AutocompleteProps,
  Flex,
  Input,
  Loader,
  MultiSelect,
  type MultiSelectProps,
  SegmentedControl,
  type SegmentedControlProps,
  Select,
  type SelectProps,
  TagsInput,
  type TagsInputProps,
} from "@mantine/core";
import type { Async } from "alepha";
import { useAction } from "alepha/react";
import { useFieldValue, useFormState } from "alepha/react/form";
import { useEffect, useRef, useState } from "react";
import { type GenericControlProps, parseInput } from "../utils/parseInput.ts";

export type SelectValueLabel =
  | string
  | { value: string; label: string; icon?: string };

type LoaderMode = "static" | "short" | "long";

export interface ControlSelectProps extends GenericControlProps {
  /**
   * If true, allows creating new values not present in the options list.
   * For single values, Select becomes an Autocomplete.
   * For arrays, MultiSelect becomes a TagsInput.
   */
  creatable?: boolean;

  /**
   * Configure select with optional SelectProps.
   */
  selectProps?: boolean | SelectProps;

  /**
   * Configure select as multi-select (for array of enums) with optional MultiSelectProps.
   */
  multiSelectProps?: boolean | MultiSelectProps;

  /**
   * If true, renders a SegmentedControl instead of Select/MultiSelect.
   */
  segmentedProps?: boolean | Partial<SegmentedControlProps>;

  /**
   * Props passed to the Autocomplete component when creatable is true and the field is single-value.
   */
  autocompleteProps?: Partial<AutocompleteProps>;

  /**
   * Props passed to the TagsInput component when creatable is true and the field is array-value.
   */
  tagsInputProps?: Partial<TagsInputProps>;

  /**
   * Async loader for select options.
   *
   * @param search - Search text (empty string on initial load)
   * @param resolve - Optional array of values to resolve labels for (used for default values in long mode)
   */
  loader?: (search: string, resolve?: string[]) => Async<SelectValueLabel[]>;

  /**
   * Threshold to distinguish short (client-filtered) from long (server-filtered) lists.
   * If initial load returns <= threshold items, mode is "short" (cached, client-filtered).
   * If > threshold, mode is "long" (debounced server search).
   * @default 100
   */
  loaderThreshold?: number;

  /**
   * Debounce delay in ms for server search in long mode.
   * @default 300
   */
  loaderDebounce?: number;
}

/**
 * ControlSelect component for handling Select, MultiSelect, Autocomplete, and TagsInput.
 *
 * Features:
 * - Basic Select with enum support
 * - MultiSelect for array of enums
 * - Autocomplete for creatable single values
 * - TagsInput for creatable array values
 * - Async lazy loading with auto short/long mode detection
 * - Short mode: client-side filtering with cached data
 * - Long mode: debounced server search
 *
 * Automatically detects enum values and array types from schema.
 */
const ControlSelect = (props: ControlSelectProps) => {
  const form = useFormState(props.input);
  const [value, setValue] = useFieldValue(props.input);
  const { inputProps, id, icon } = parseInput(props, form);

  // Detect if schema is an array type
  const isArray =
    props.input.schema &&
    "type" in props.input.schema &&
    props.input.schema.type === "array";

  // Detect if schema is numeric (for value coercion)
  const isNumeric =
    props.input.schema &&
    "type" in props.input.schema &&
    (props.input.schema.type === "integer" ||
      props.input.schema.type === "number");

  // Detect if schema is boolean (for value coercion)
  const isBoolean =
    props.input.schema &&
    "type" in props.input.schema &&
    props.input.schema.type === "boolean";

  // Extract enum values from schema (for non-array select)
  const enumValues =
    props.input.schema &&
    "enum" in props.input.schema &&
    Array.isArray(props.input.schema.enum)
      ? props.input.schema.enum
      : [];

  // Async loader hook
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

  // Static data from enum (no loader)
  const [staticData, setStaticData] = useState<SelectValueLabel[]>([]);

  const enumKey = JSON.stringify(enumValues);
  useEffect(() => {
    if (!props.input?.props || props.loader) return;
    if (isBoolean && enumValues.length === 0) {
      setStaticData([
        { value: "true", label: "True" },
        { value: "false", label: "False" },
      ]);
    } else {
      setStaticData(enumValues);
    }
  }, [props.input, props.loader, enumKey, isBoolean]);

  const data = props.loader ? asyncData : staticData;

  if (!props.input?.props) {
    return null;
  }

  /**
   * Coerce value for numeric schemas — Select values are always strings.
   */
  const coerceValue = (val: string | null) => {
    if (val == null) return val;
    if (isNumeric) return Number(val);
    if (isBoolean) return val === "true";
    return val;
  };

  // region <SegmentedControl/> — early return
  if (props.segmentedProps) {
    const segmentedControlProps: Partial<SegmentedControlProps> =
      typeof props.segmentedProps === "object" ? props.segmentedProps : {};
    const segmentedData = segmentedControlProps.data ?? data.slice(0, 10);

    return (
      <Input.Wrapper {...inputProps}>
        <Flex>
          <SegmentedControl
            w={"100%"}
            disabled={inputProps.disabled}
            value={value != null ? String(value) : undefined}
            {...segmentedControlProps}
            onChange={(val) => {
              setValue(coerceValue(val));
            }}
            data={segmentedData}
          />
        </Flex>
      </Input.Wrapper>
    );
  }
  // endregion

  // Shared props used by all select-like components
  const sharedProps = {
    size: props.size,
    id,
    leftSection: loading ? <Loader color={"gray"} size={10} /> : icon,
    data,
    // TODO: set in $atom ?
    inputWrapperOrder: ["label", "input", "description", "error"] as (
      | "input"
      | "label"
      | "description"
      | "error"
    )[],
  };

  // Select and MultiSelect: searchable + hide default chevron
  const selectableProps = {
    ...sharedProps,
    searchable: true,
    rightSection: <span />,
  };

  // Long mode additions: bypass client filter + wire server search
  const longModeProps =
    mode === "long"
      ? {
          filter: ({ options }: { options: any[] }) => options,
          onSearchChange: search.run,
        }
      : {};

  // region <TagsInput/> — creatable + array
  if (props.creatable && (isArray || props.tagsInputProps)) {
    const tagsInputExtraProps = props.tagsInputProps ?? {};

    return (
      <TagsInput
        {...inputProps}
        {...sharedProps}
        {...longModeProps}
        value={Array.isArray(value) ? value : []}
        onChange={(val) => {
          setValue(val);
        }}
        {...tagsInputExtraProps}
      />
    );
  }
  // endregion

  // region <Autocomplete/> — creatable + single
  if (props.creatable) {
    const autocompleteExtraProps = props.autocompleteProps ?? {};

    return (
      <Autocomplete
        {...inputProps}
        {...sharedProps}
        {...longModeProps}
        value={value != null ? String(value) : ""}
        onChange={(val) => {
          setValue(coerceValue(val));
        }}
        {...autocompleteExtraProps}
      />
    );
  }
  // endregion

  // region <MultiSelect/> — array (non-creatable)
  if (isArray || props.multiSelectProps) {
    const multiSelectExtraProps =
      typeof props.multiSelectProps === "object" ? props.multiSelectProps : {};

    return (
      <MultiSelect
        {...inputProps}
        {...selectableProps}
        {...longModeProps}
        value={Array.isArray(value) ? value : []}
        onChange={(val) => {
          setValue(val);
        }}
        {...multiSelectExtraProps}
      />
    );
  }
  // endregion

  // region <Select/> — single value (static, short, or long mode)
  const selectExtraProps =
    typeof props.selectProps === "object" ? props.selectProps : {};

  // Static mode
  if (mode === "static") {
    return (
      <Select
        {...inputProps}
        {...selectableProps}
        value={value != null ? String(value) : null}
        onChange={(val) => {
          setValue(coerceValue(val));
        }}
        {...selectExtraProps}
      />
    );
  }

  // Short or long mode
  return (
    <Select
      {...inputProps}
      {...selectableProps}
      {...longModeProps}
      value={value != null ? String(value) : null}
      onChange={(val) => {
        setValue(coerceValue(val));
      }}
      {...selectExtraProps}
    />
  );
  // endregion
};

export default ControlSelect;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Hook for async select data loading with auto short/long mode detection.
 */
const useAsyncLoader = (
  loader: ControlSelectProps["loader"],
  threshold: number,
  debounceMs: number,
  defaultValue: any,
) => {
  const [data, setData] = useState<SelectValueLabel[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoaderMode>("static");
  const cache = useRef(new Map<string, SelectValueLabel[]>());

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
        const result = await loader("");
        const isShort = result.length <= threshold;
        setMode(isShort ? "short" : "long");
        cache.current.set("", result);
        setData(result);

        // In long mode, resolve default value label before clearing loading
        if (!isShort && defaultValue != null && String(defaultValue) !== "") {
          const resolved = await loader("", [String(defaultValue)]);
          if (resolved.length > 0) {
            setData((prev) => {
              const existing = new Set(
                prev.map((d) => (typeof d === "string" ? d : d.value)),
              );
              const newItems = resolved.filter((r) => {
                const val = typeof r === "string" ? r : r.value;
                return !existing.has(val);
              });
              return [...prev, ...newItems];
            });
          }
        }

        setLoading(false);
      },
    },
    [loader, threshold],
  );

  // Debounced search (long mode only)
  const search = useAction<[string]>(
    {
      debounce: debounceMs,
      handler: async (text) => {
        if (!loader || mode !== "long") return;

        // Check cache first (immediate, no network)
        if (cache.current.has(text)) {
          setData(cache.current.get(text)!);
          return;
        }

        setLoading(true);
        const result = await loader(text);
        cache.current.set(text, result);
        setData(result);
        setLoading(false);
      },
    },
    [loader, mode, debounceMs],
  );

  return { data, loading, mode, search };
};
