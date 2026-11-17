import { useCallback, useState } from "react";

import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";

/**
 * How many steps back a draft keeps.
 */
const HISTORY = 100;

interface DraftState {
  past: AutomationGraphValue[];
  present: AutomationGraphValue;
  future: AutomationGraphValue[];
  saved: string;
}

/**
 * One draft of an automation's graph (#Q3811), with its undo and redo.
 *
 * `change` records a step unless asked not to: a drag moves a node on every
 * frame, so the drag's start is the `checkpoint` and its frames are not
 * steps. `dirty` compares the draft with what was last saved.
 */
export const useAutomationDraft = (initial: AutomationGraphValue) => {
  const [state, setState] = useState<DraftState>(() => ({
    past: [],
    present: initial,
    future: [],
    saved: JSON.stringify(initial),
  }));
  const change = useCallback(
    (
      next: (graph: AutomationGraphValue) => AutomationGraphValue,
      options: { record?: boolean } = {},
    ) =>
      setState((current) => {
        const graph = next(current.present);
        if (graph === current.present) return current;
        return options.record === false
          ? { ...current, present: graph }
          : {
              ...current,
              past: [...current.past, current.present].slice(-HISTORY),
              present: graph,
              future: [],
            };
      }),
    [],
  );
  const checkpoint = useCallback(
    () =>
      setState((current) => ({
        ...current,
        past: [...current.past, current.present].slice(-HISTORY),
        future: [],
      })),
    [],
  );
  const undo = useCallback(
    () =>
      setState((current) =>
        current.past.length
          ? {
              ...current,
              past: current.past.slice(0, -1),
              present: current.past[current.past.length - 1],
              future: [current.present, ...current.future],
            }
          : current,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setState((current) =>
        current.future.length
          ? {
              ...current,
              past: [...current.past, current.present],
              present: current.future[0],
              future: current.future.slice(1),
            }
          : current,
      ),
    [],
  );
  /**
   * Start over from `graph`, as saved: after a save, or a reload.
   */
  const reset = useCallback(
    (graph: AutomationGraphValue) =>
      setState({
        past: [],
        present: graph,
        future: [],
        saved: JSON.stringify(graph),
      }),
    [],
  );
  return {
    graph: state.present,
    dirty: JSON.stringify(state.present) !== state.saved,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    change,
    checkpoint,
    undo,
    redo,
    reset,
  };
};
