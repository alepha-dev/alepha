/**
 * What a bulk call answers: the ids the server took, and the ones it
 * refused with the reason it gave. Nine deleted and one refused is not a
 * success, and this is the shape that keeps a caller from saying it is.
 *
 * The id type is a parameter because not every row is keyed by an integer:
 * an artifact's id is a uuid.
 */
export interface BulkOutcome<Id extends number | string = number> {
  done: Id[];
  failed: Array<{ id: Id; error: unknown }>;
}

/**
 * Run one call per id, all at once, and sort the outcomes.
 *
 * Concurrent calls go out as one `POST /api/_batch`, so a selection of
 * twenty costs one round trip; `allSettled` is what keeps one refusal from
 * hiding the nineteen that landed.
 *
 * Lives here rather than inside `useQuestMutations` because the Epics list
 * needs the same thing (feedback #2086), and a second copy is how two lists
 * start disagreeing about what a half-failed bulk looks like. Pure, and no
 * hook: it takes the call it should make.
 */
export const settleBulk = async <Id extends number | string = number>(
  ids: Id[],
  call: (id: Id) => Promise<unknown>,
): Promise<BulkOutcome<Id>> => {
  const results = await Promise.allSettled(ids.map((id) => call(id)));
  const outcome: BulkOutcome<Id> = { done: [], failed: [] };
  results.forEach((result, index) => {
    const id = ids[index];
    if (result.status === "fulfilled") {
      outcome.done.push(id);
    } else {
      outcome.failed.push({ id, error: result.reason });
    }
  });
  return outcome;
};
