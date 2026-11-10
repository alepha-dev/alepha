/**
 * Whether an error means the request got no HTTP response: the network is
 * down or the host unreachable. Any response at all, a 500 included, is not
 * one: the API is there and answered.
 *
 * An abort is not a network error here: a caller that also wants to count it
 * checks for it first, as `ReactBootHealth` does.
 *
 * Read through the `cause` chain, since a client may wrap the failure.
 */
export const isNetworkError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current !== "object") {
      return false;
    }
    const it = current as { name?: string; message?: string; cause?: unknown };
    if (
      it.name === "TypeError" &&
      /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(
        it.message ?? "",
      )
    ) {
      return true;
    }
    current = it.cause;
  }
  return false;
};

/**
 * Whether an error is an abort, anywhere along its `cause` chain.
 */
export const isAbortError = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current !== "object") {
      return false;
    }
    const it = current as { name?: string; cause?: unknown };
    if (it.name === "AbortError") {
      return true;
    }
    current = it.cause;
  }
  return false;
};
