import { Segmented } from "@alepha/ui/components/ui/segmented";

export interface AlephaTableFilterOperatorProps {
  /**
   * The operators this filter offers, in order. ⚠️ The FIRST is the default:
   * choosing it reports `undefined`, so a filter left on its default carries
   * no operator key at all, neither in the query nor in a shared link.
   */
  options: AlephaTableFilterOperatorOption[];

  /**
   * The operator in force, or `undefined` for the default.
   */
  value?: string;

  onChange: (value: string | undefined) => void;
}

/**
 * The operator switch a filter's list carries at its top: "is / is not",
 * "any of / all of / none of".
 *
 * One switch, not an EQUAL/NOT toggle beside an OR/AND one. Two toggles make
 * four combinations, and on a column holding one value per row two of them
 * are meaningless: "Owner AND Viewer" matches nobody, and its negation
 * matches everybody. Listing the operators that exist exposes only the
 * choices that do something.
 *
 * It lives INSIDE the popup rather than on the bar because it is set once
 * and read often: the bar shows only its outcome, as a prefix on the
 * trigger ("not Active"), and only when it is not the default.
 *
 * Mount it through `Control`'s `popupHeader`. A filter whose backend supports
 * no operator simply passes none, and nothing is drawn.
 */
export const AlephaTableFilterOperator = (
  props: AlephaTableFilterOperatorProps,
) => {
  const fallback = props.options[0]?.value;

  return (
    <div className="border-b p-1">
      <Segmented
        size="xs"
        fullWidth
        options={props.options}
        value={props.value ?? fallback}
        onChange={(value) =>
          props.onChange(value === fallback ? undefined : value)
        }
      />
    </div>
  );
};

export interface AlephaTableFilterOperatorOption {
  /**
   * What the query carries, e.g. `not`. Must be a value the backend's query
   * schema accepts for this filter's operator key.
   */
  value: string;
  label: string;
}
