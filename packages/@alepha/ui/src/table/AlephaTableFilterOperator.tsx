import { Segmented } from "../core/Segmented.tsx";

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
  /**
   * The word drawn before the value on the bar while this operator is in
   * force, so "not Active" never reads as "Active". The default operator has
   * none.
   */
  prefix?: string;
}

/**
 * The operator sets a filter bar offers by name, labelled in the kit's own
 * catalog so a caller does not translate "is not" itself:
 *
 * - `is`: is / is not, for a list the column holds ONE value of. Values `is`
 *   and `not`.
 * - `any-none`: any of / none of, the same column with several picks. Values
 *   `any` and `none`. There is no "all of": a row has one value, so it could
 *   only ever match nobody.
 * - `any-all-none`: any / all / none of, for a column holding SEVERAL values
 *   (tags). Values `any`, `all` and `none`.
 */
export type AlephaTableFilterOperatorPreset =
  | "is"
  | "any-none"
  | "any-all-none";
