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
import { useFormState } from "alepha/react/form";
import { useCallback, useEffect, useRef, useState } from "react";
import { type GenericControlProps, parseInput } from "../utils/parseInput.ts";

export type SelectValueLabel =
  | string
  | { value: string; label: string; icon?: string };

type LoaderMode = "static" | "short" | "long";

export interface ControlSelectProps extends GenericControlProps {
  select?: boolean | SelectProps;
  multi?: boolean | MultiSelectProps;
  tags?: boolean | TagsInputProps;
  autocomplete?: boolean | AutocompleteProps;
  segmented?: boolean | Partial<SegmentedControlProps>;

  /**
   * Async loader for select options.
   *
   * @param search - Search text (empty string on initial load)
   * @param resolve - Optional array of values to resolve labels for (used for default values in long mode)
   */
  loader?: (search: string, resolve?: string[]) => Promise<SelectValueLabel[]>;

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
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Initial load — determines mode
  useEffect(() => {
    if (!loader) {
      setMode("static");
      return;
    }

    setLoading(true);
    loader("").then((result) => {
      const isShort = result.length <= threshold;
      setMode(isShort ? "short" : "long");
      cache.current.set("", result);
      setData(result);
      setLoading(false);

      // In long mode, resolve default value label
      if (!isShort && defaultValue != null && String(defaultValue) !== "") {
        loader("", [String(defaultValue)]).then((resolved) => {
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
        });
      }
    });
  }, [loader, threshold]);

  // Debounced search (long mode only)
  const search = useCallback(
    (text: string) => {
      if (!loader || mode !== "long") return;

      // Check cache first
      if (cache.current.has(text)) {
        setData(cache.current.get(text)!);
        return;
      }

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setLoading(true);
        loader(text).then((result) => {
          cache.current.set(text, result);
          setData(result);
          setLoading(false);
        });
      }, debounceMs);
    },
    [loader, mode, debounceMs],
  );

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { data, loading, mode, search };
};

/**
 * ControlSelect component for handling Select, MultiSelect, and TagsInput.
 *
 * Features:
 * - Basic Select with enum support
 * - MultiSelect for array of enums
 * - TagsInput for array of strings (no enum)
 * - Async lazy loading with auto short/long mode detection
 * - Short mode: client-side filtering with cached data
 * - Long mode: debounced server search
 *
 * Automatically detects enum values and array types from schema.
 */
const ControlSelect = (props: ControlSelectProps) => {
  const form = useFormState(props.input);
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

  // For arrays, check if items have enum (MultiSelect) or not (TagsInput)
  let itemsEnum: string[] | undefined;
  if (isArray && "items" in props.input.schema && props.input.schema.items) {
    const items: any = props.input.schema.items;
    if ("enum" in items && Array.isArray(items.enum)) {
      itemsEnum = items.enum;
    }
  }

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
    props.input.props?.defaultValue,
  );

  // Static data from enum (no loader)
  const [staticData, setStaticData] = useState<SelectValueLabel[]>([]);

  useEffect(() => {
    if (!props.input?.props || props.loader) return;
    setStaticData(enumValues);
  }, [props.input, props.loader]);

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
    return val;
  };

  if (props.segmented) {
    const segmentedControlProps: Partial<SegmentedControlProps> =
      typeof props.segmented === "object" ? props.segmented : {};

    return (
      <Input.Wrapper {...inputProps}>
        <Flex>
          <SegmentedControl
            disabled={inputProps.disabled}
            defaultValue={String(props.input.props.defaultValue)}
            {...segmentedControlProps}
            onChange={(value) => {
              props.input.set(coerceValue(value));
            }}
            data={data.slice(0, 10)}
          />
        </Flex>
      </Input.Wrapper>
    );
  }

  if (props.autocomplete) {
    const autocompleteProps =
      typeof props.autocomplete === "object" ? props.autocomplete : {};

    return (
      <Autocomplete
        {...inputProps}
        size={props.size}
        id={id}
        leftSection={icon}
        data={data}
        {...props.input.props}
        {...autocompleteProps}
      />
    );
  }

  // region <TagsInput/> - for array of strings without enum
  if ((isArray && !itemsEnum) || props.tags) {
    const tagsInputProps = typeof props.tags === "object" ? props.tags : {};
    return (
      <TagsInput
        {...inputProps}
        size={props.size}
        id={id}
        leftSection={icon}
        defaultValue={
          Array.isArray(props.input.props.defaultValue)
            ? props.input.props.defaultValue
            : []
        }
        onChange={(value) => {
          props.input.set(value);
        }}
        {...tagsInputProps}
      />
    );
  }
  // endregion

  // region <MultiSelect/> - for array of enums
  if ((isArray && itemsEnum) || props.multi) {
    const data =
      itemsEnum?.map((value: string) => ({
        value,
        label: value,
      })) || [];

    const multiSelectProps = typeof props.multi === "object" ? props.multi : {};

    return (
      <MultiSelect
        {...inputProps}
        size={props.size}
        id={id}
        leftSection={icon}
        data={data}
        defaultValue={
          Array.isArray(props.input.props.defaultValue)
            ? props.input.props.defaultValue
            : []
        }
        onChange={(value) => {
          props.input.set(value);
        }}
        {...multiSelectProps}
      />
    );
  }
  // endregion

  // region <Select/> - for single value (static, short, or long mode)
  const selectProps = typeof props.select === "object" ? props.select : {};

  // Short mode: searchable + clearable, client-side filter
  if (mode === "short") {
    return (
      <Select
        {...inputProps}
        size={props.size}
        id={id}
        leftSection={icon}
        rightSection={loading ? <Loader size="xs" /> : null}
        searchable
        clearable
        data={data}
        defaultValue={
          props.input.props.defaultValue != null
            ? String(props.input.props.defaultValue)
            : undefined
        }
        onChange={(value) => {
          props.input.set(coerceValue(value));
        }}
        {...selectProps}
      />
    );
  }

  // Long mode: searchable + server-side filter via onSearchChange
  if (mode === "long") {
    return (
      <Select
        {...inputProps}
        size={props.size}
        id={id}
        leftSection={icon}
        rightSection={loading ? <Loader size="xs" /> : null}
        searchable
        clearable
        data={data}
        filter={({ options }) => options}
        onSearchChange={search}
        defaultValue={
          props.input.props.defaultValue != null
            ? String(props.input.props.defaultValue)
            : undefined
        }
        onChange={(value) => {
          props.input.set(coerceValue(value));
        }}
        {...selectProps}
      />
    );
  }

  // Static mode: enum-based select
  return (
    <Select
      {...inputProps}
      size={props.size}
      id={id}
      leftSection={icon}
      rightSection={<Flex />}
      clearable
      data={data}
      {...props.input.props}
      onChange={(value) => {
        props.input.set(coerceValue(value));
      }}
      {...selectProps}
    />
  );
  // endregion
};

export default ControlSelect;
