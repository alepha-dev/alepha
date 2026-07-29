export interface FilterOperators<TValue> {
  /**
   * Test that two values are equal.
   *
   * Remember that the SQL standard dictates that
   * two NULL values are not equal, so if you want to test
   * whether a value is null, you may want to use
   * `isNull` instead.
   *
   * ## Examples
   *
   * ```ts
   * // Select cars made by Ford
   * repository.findMany({ where: { make: { eq: "Ford" } } })
   * ```
   *
   * @see isNull for a way to test equality to NULL.
   */
  eq?: TValue;

  /**
   * Test that two values are not equal.
   *
   * Remember that the SQL standard dictates that
   * two NULL values are not equal, so if you want to test
   * whether a value is not null, you may want to use
   * `isNotNull` instead.
   *
   * ## Examples
   *
   * ```ts
   * // Select cars not made by Ford
   * repository.findMany({ where: { make: { ne: "Ford" } } })
   * ```
   *
   * @see isNotNull for a way to test whether a value is not null.
   */
  ne?: TValue;

  /**
   * Test that the first expression passed is greater than
   * the second expression.
   *
   * ## Examples
   *
   * ```ts
   * // Select cars made after 2000.
   * repository.findMany({ where: { year: { gt: 2000 } } })
   * ```
   *
   * @see gte for greater-than-or-equal
   */
  gt?: TValue;

  /**
   * Test that the first expression passed is greater than
   * or equal to the second expression. Use `gt` to
   * test whether an expression is strictly greater
   * than another.
   *
   * ## Examples
   *
   * ```ts
   * // Select cars made on or after 2000.
   * repository.findMany({ where: { year: { gte: 2000 } } })
   * ```
   *
   * @see gt for a strictly greater-than condition
   */
  gte?: TValue;

  /**
   * Test that the first expression passed is less than
   * the second expression.
   *
   * ## Examples
   *
   * ```ts
   * // Select cars made before 2000.
   * repository.findMany({ where: { year: { lt: 2000 } } })
   * ```
   *
   * @see lte for greater-than-or-equal
   */
  lt?: TValue;

  /**
   * Test that the first expression passed is less than
   * or equal to the second expression.
   *
   * ## Examples
   *
   * ```ts
   * // Select cars made in or before 2000.
   * repository.findMany({ where: { year: { lte: 2000 } } })
   * ```
   *
   * @see lt for a strictly less-than condition
   */
  lte?: TValue;

  /**
   * Test whether the first parameter, a column or expression,
   * has a value from a list passed as the second argument.
   *
   * ## Throws
   *
   * The argument passed in the second array can't be empty:
   * if an empty is provided, this method will throw.
   *
   * ## Examples
   *
   * ```ts
   * // Select cars made by Ford or GM.
   * repository.findMany({ where: { make: { inArray: ["Ford", "GM"] } } })
   * ```
   *
   * @see notInArray for the inverse of this test
   */
  inArray?: TValue[];

  /**
   * Test whether the first parameter, a column or expression,
   * has a value that is not present in a list passed as the
   * second argument.
   *
   * ## Throws
   *
   * The argument passed in the second array can't be empty:
   * if an empty is provided, this method will throw.
   *
   * ## Examples
   *
   * ```ts
   * // Select cars made by any company except Ford or GM.
   * repository.findMany({ where: { make: { notInArray: ["Ford", "GM"] } } })
   * ```
   *
   * @see inArray for the inverse of this test
   */
  notInArray?: TValue[];

  /**
   * Test whether an expression is not NULL. By the SQL standard,
   * NULL is neither equal nor not equal to itself, so
   * it's recommended to use `isNull` and `notIsNull` for
   * comparisons to NULL.
   *
   * ## Examples
   *
   * ```ts
   * // Select cars that have been discontinued.
   * repository.findMany({ where: { discontinuedAt: { isNotNull: true } } })
   * ```
   *
   * @see isNull for the inverse of this test
   */
  isNotNull?: true;

  /**
   * Test whether an expression is NULL. By the SQL standard,
   * NULL is neither equal nor not equal to itself, so
   * it's recommended to use `isNull` and `notIsNull` for
   * comparisons to NULL.
   *
   * ## Examples
   *
   * ```ts
   * // Select cars that have no discontinuedAt date.
   * repository.findMany({ where: { discontinuedAt: { isNull: true } } })
   * ```
   *
   * @see isNotNull for the inverse of this test
   */
  isNull?: true;

  /**
   * Test whether an expression is between two values. This
   * is an easier way to express range tests, which would be
   * expressed mathematically as `x <= a <= y` but in SQL
   * would have to be like `a >= x AND a <= y`.
   *
   * Between is inclusive of the endpoints: if `column`
   * is equal to `min` or `max`, it will be TRUE.
   *
   * ## Examples
   *
   * ```ts
   * // Select cars made between 1990 and 2000
   * repository.findMany({ where: { year: { between: [1990, 2000] } } })
   * ```
   *
   * @see notBetween for the inverse of this test
   */
  between?: [number, number];

  /**
   * Test whether an expression is not between two values.
   *
   * This, like `between`, includes its endpoints, so if
   * the `column` is equal to `min` or `max`, in this case
   * it will evaluate to FALSE.
   *
   * ## Examples
   *
   * ```ts
   * // Exclude cars made in the 1970s
   * repository.findMany({ where: { year: { notBetween: [1970, 1979] } } })
   * ```
   *
   * @see between for the inverse of this test
   */
  notBetween?: [number, number];

  /**
   * Compare a column to a pattern, which can include `%` and `_`
   * characters to match multiple variations. Including `%`
   * in the pattern matches zero or more characters, and including
   * `_` will match a single character.
   *
   * ## Examples
   *
   * ```ts
   * // Select all cars with 'Turbo' in their names.
   * repository.findMany({ where: { name: { like: "%Turbo%" } } })
   * ```
   *
   * @see ilike for a case-insensitive version of this condition
   */
  like?: string;

  /**
   * The inverse of like - this tests that a given column
   * does not match a pattern, which can include `%` and `_`
   * characters to match multiple variations. Including `%`
   * in the pattern matches zero or more characters, and including
   * `_` will match a single character.
   *
   * ## Examples
   *
   * ```ts
   * // Select all cars that don't have "Rover" in their name.
   * repository.findMany({ where: { name: { notLike: "%Rover%" } } })
   * ```
   *
   * @see like for the inverse condition
   * @see notIlike for a case-insensitive version of this condition
   */
  notLike?: string;

  /**
   * Case-insensitively compare a column to a pattern,
   * which can include `%` and `_`
   * characters to match multiple variations. Including `%`
   * in the pattern matches zero or more characters, and including
   * `_` will match a single character.
   *
   * Unlike like, this performs a case-insensitive comparison.
   *
   * ## Examples
   *
   * ```ts
   * // Select all cars with 'Turbo' in their names, whatever the casing.
   * repository.findMany({ where: { name: { ilike: "%Turbo%" } } })
   * ```
   *
   * @see like for a case-sensitive version of this condition
   */
  ilike?: string;

  /**
   * Case-insensitive EQUALITY — `LOWER(column) = LOWER(value)`.
   *
   * Use this, not `ilike`, when you mean "the same string ignoring case".
   * `ilike` is a pattern match: `_` matches any single character and `%` any
   * run of them, so a raw user-supplied value is a wildcard expression. On an
   * identifier lookup that is wrong (and on an auth path, dangerous):
   * `admi_` matches `admin`, `admix`, … and `findOne` then picks one
   * arbitrarily.
   *
   * Mirrors the shape of a `LOWER(col)` unique index, so a lookup and the
   * constraint that guards it agree.
   *
   * ```ts
   * // exactly one user, whatever the casing
   * where: { username: { eqInsensitive: input } }
   * ```
   */
  eqInsensitive?: string;

  /**
   * The inverse of ilike - this case-insensitively tests that a given column
   * does not match a pattern, which can include `%` and `_`
   * characters to match multiple variations. Including `%`
   * in the pattern matches zero or more characters, and including
   * `_` will match a single character.
   *
   * ## Examples
   *
   * ```ts
   * // Select all cars that don't have "Rover" in their name, whatever the casing.
   * repository.findMany({ where: { name: { notIlike: "%Rover%" } } })
   * ```
   *
   * @see ilike for the inverse condition
   * @see notLike for a case-sensitive version of this condition
   */
  notIlike?: string;

  /**
   * Syntactic sugar for case-insensitive substring matching.
   * Automatically wraps the value with `%` wildcards on both sides.
   *
   * Equivalent to: `ilike: '%value%'`
   *
   * ## Examples
   *
   * ```ts
   * // Select all cars with "Turbo" anywhere in their name.
   * repository.findMany({ where: { name: { contains: "Turbo" } } })
   * // Same as: { name: { ilike: "%Turbo%" } }
   * ```
   *
   * @see ilike for manual pattern matching
   * @see startsWith for prefix matching
   * @see endsWith for suffix matching
   */
  contains?: string;

  /**
   * Syntactic sugar for case-insensitive prefix matching.
   * Automatically appends a `%` wildcard to the end of the value.
   *
   * Equivalent to: `ilike: 'value%'`
   *
   * ## Examples
   *
   * ```ts
   * // Select all cars whose names start with "Ford".
   * repository.findMany({ where: { name: { startsWith: "Ford" } } })
   * // Same as: { name: { ilike: "Ford%" } }
   * ```
   *
   * @see ilike for manual pattern matching
   * @see contains for substring matching
   * @see endsWith for suffix matching
   */
  startsWith?: string;

  /**
   * Syntactic sugar for case-insensitive suffix matching.
   * Automatically prepends a `%` wildcard to the beginning of the value.
   *
   * Equivalent to: `ilike: '%value'`
   *
   * ## Examples
   *
   * ```ts
   * // Select all cars whose names end with "Turbo".
   * repository.findMany({ where: { name: { endsWith: "Turbo" } } })
   * // Same as: { name: { ilike: "%Turbo" } }
   * ```
   *
   * @see ilike for manual pattern matching
   * @see contains for substring matching
   * @see startsWith for prefix matching
   */
  endsWith?: string;

  /**
   * Test that a column or expression contains all elements of
   * the list passed as the second argument.
   *
   * ## Throws
   *
   * The argument passed in the second array can't be empty:
   * if an empty is provided, this method will throw.
   *
   * ## Examples
   *
   * ```ts
   * // Select posts where its tags contain "Typescript" and "ORM".
   * repository.findMany({ where: { tags: { arrayContains: ["Typescript", "ORM"] } } })
   * ```
   *
   * @see arrayContained to find if an array contains all elements of a column or expression
   * @see arrayOverlaps to find if a column or expression contains any elements of an array
   */
  arrayContains?: TValue;

  /**
   * Test that the list passed as the second argument contains
   * all elements of a column or expression.
   *
   * ## Throws
   *
   * The argument passed in the second array can't be empty:
   * if an empty is provided, this method will throw.
   *
   * ## Examples
   *
   * ```ts
   * // Select posts where its tags contain "Typescript", "ORM" or both,
   * // but filtering posts that have additional tags.
   * repository.findMany({ where: { tags: { arrayContained: ["Typescript", "ORM"] } } })
   * ```
   *
   * @see arrayContains to find if a column or expression contains all elements of an array
   * @see arrayOverlaps to find if a column or expression contains any elements of an array
   */
  arrayContained?: TValue;

  /**
   * Test that a column or expression contains any elements of
   * the list passed as the second argument.
   *
   * ## Throws
   *
   * The argument passed in the second array can't be empty:
   * if an empty is provided, this method will throw.
   *
   * ## Examples
   *
   * ```ts
   * // Select posts where its tags contain "Typescript", "ORM" or both.
   * repository.findMany({ where: { tags: { arrayOverlaps: ["Typescript", "ORM"] } } })
   * ```
   *
   * @see arrayContains to find if a column or expression contains all elements of an array
   * @see arrayContained to find if an array contains all elements of a column or expression
   */
  arrayOverlaps?: TValue;
}
