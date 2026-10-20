import type {
  AdminAnalyticsQuery,
  AdminDatasetDescriptor,
} from "alepha/api/analytics";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha } from "alepha/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ANALYTICS_MAX_LIMIT,
  analyticsActiveMeasures,
  analyticsAdvancedDirty,
  analyticsDefaultOrderBy,
  analyticsDimensions,
  analyticsDefaultGrain,
  analyticsGrainLock,
  analyticsIsTimeGrain,
  analyticsKeyFold,
  analyticsKeyLabel,
  analyticsMeasures,
  analyticsRequestBody,
  analyticsSelectKeys,
  analyticsStateWindow,
  analyticsTimeGrains,
  analyticsWindowBody,
} from "./analyticsModel.ts";
import type {
  AnalyticsChartShape,
  AnalyticsCompareMode,
  AnalyticsInstantRange,
  AnalyticsQueryState,
  AnalyticsRow,
  AnalyticsRunResult,
  AnalyticsTimeGrain,
  AnalyticsTransport,
  AnalyticsUntilMode,
  AnalyticsView,
  AnalyticsWindow,
} from "./analyticsTypes.ts";

/**
 * The query the panel starts on: the last thirty complete days, by day,
 * against the previous thirty.
 */
const initialQueryState = (dataset: string): AnalyticsQueryState => ({
  dataset,
  days: 30,
  instant: null,
  untilMode: "yesterday",
  compare: "previous",
  groupBy: ["day"],
  filters: [],
  limit: 200,
  measures: null,
  orderBy: null,
});

/**
 * How the current result is drawn. Separate from {@link AnalyticsQueryState}
 * because none of it reaches the wire: changing the shape re-reads the rows
 * already fetched, changing the query re-fetches them.
 */
export interface AnalyticsViewState {
  view: AnalyticsView;
  shape: AnalyticsChartShape | null;
  axis: string | null;
  chartMeasure: string | null;
}

export interface AnalyticsQueryApi {
  dataset?: AdminDatasetDescriptor;
  state: AnalyticsQueryState;
  viewState: AnalyticsViewState;
  window: AnalyticsWindow;
  baselineWindow: AnalyticsWindow | null;
  dimensions: string[];
  /**
   * Every value key the dataset offers (see `analyticsMeasures`).
   */
  measures: string[];
  activeMeasures: string[];
  /**
   * The time grains the dataset has, each with why it is locked over the
   * current window, or `null` when it is usable.
   */
  grains: Array<{
    grain: AnalyticsTimeGrain;
    lock: "retention" | "points" | null;
  }>;
  advancedDirty: boolean;
  /**
   * The body the next run will send, live as the panel is edited. The request
   * dialog reads this rather than the last result's, so it answers "what am I
   * about to ask" and not "what did I ask".
   */
  body: AdminAnalyticsQuery;
  result?: AnalyticsRunResult;
  running: boolean;
  error?: string;
  selectDataset: (name: string) => void;
  toggleMeasure: (name: string) => void;
  setDays: (days: number) => void;
  setInstant: (instant: AnalyticsInstantRange) => void;
  setUntilMode: (mode: AnalyticsUntilMode) => void;
  setCompare: (mode: AnalyticsCompareMode) => void;
  toggleGroupBy: (name: string) => void;
  setLimit: (limit: number) => void;
  sortBy: (key: string) => void;
  applyFilter: (dim: string, values: string[]) => void;
  removeFilter: (dim: string) => void;
  setView: (view: AnalyticsView) => void;
  setShape: (shape: AnalyticsChartShape) => void;
  setAxis: (axis: string) => void;
  setChartMeasure: (measure: string) => void;
  reset: () => void;
  run: () => void;
}

const emptyView: AnalyticsViewState = {
  view: "overview",
  shape: null,
  axis: null,
  chartMeasure: null,
};

/**
 * The whole query surface: state, the interlocks that keep it answerable, and
 * the runs it produces.
 *
 * Every edit re-runs, debounced. The design's own controls demand it: the
 * truncation banner's "Raise to 200" and a click on a sortable column both
 * change the query, and neither means anything if the numbers below them stay
 * stale until someone presses Run.
 */
export const useAnalyticsQuery = (
  datasets: AdminDatasetDescriptor[] | undefined,
  transport: AnalyticsTransport,
): AnalyticsQueryApi => {
  const alepha = useAlepha();
  const dateTime = alepha.inject(DateTimeProvider);

  const [state, setState] = useState<AnalyticsQueryState>(() =>
    initialQueryState(""),
  );
  const [viewState, setViewState] = useState<AnalyticsViewState>(emptyView);
  const [result, setResult] = useState<AnalyticsRunResult>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);

  // Until something is picked, the first dataset the API returned is the
  // selection. Derived rather than written into state by an effect: the state
  // has no dataset-dependent field, so there is nothing an effect would have
  // to reconcile, and a render that has the list already has the answer.
  const selected = state.dataset || (datasets?.[0]?.name ?? "");
  const dataset = datasets?.find((entry) => entry.name === selected);

  // `nonce` is a dependency although the callback never reads it: pressing Run
  // re-reads the clock, so a tab left open across midnight re-resolves
  // "yesterday" instead of querying the previous day forever, and a relative
  // range moves up to the current minute.
  const now = useMemo(() => dateTime.nowMillis(), [dateTime, nonce]);

  const window = useMemo(
    () => analyticsStateWindow(now, state, 0),
    [now, state],
  );
  const baselineWindow = useMemo(
    () =>
      state.compare === "off" ? null : analyticsStateWindow(now, state, 1),
    [now, state],
  );

  const dimensions = useMemo(
    () => (dataset ? analyticsDimensions(dataset) : []),
    [dataset],
  );
  const measures = useMemo(
    () => (dataset ? analyticsMeasures(dataset) : []),
    [dataset],
  );
  const activeMeasures = useMemo(
    () => (dataset ? analyticsActiveMeasures(dataset, state) : []),
    [dataset, state],
  );

  const grains = useMemo(
    () =>
      dataset
        ? analyticsTimeGrains(dataset).map((grain) => ({
            grain,
            lock: analyticsGrainLock(dataset, grain, window, now),
          }))
        : [],
    [dataset, window, now],
  );

  const body = useMemo(
    () =>
      dataset
        ? analyticsRequestBody(dataset, state, window, now)
        : ({
            ...analyticsWindowBody(window),
            select: {},
          } as AdminAnalyticsQuery),
    [dataset, state, window, now],
  );

  const bodyKey = JSON.stringify(body);
  const baselineKey = JSON.stringify(baselineWindow);

  // A ref, not state: it only ever guards a stale response from overwriting a
  // newer one, and bumping state for that would re-run the effect that set it.
  const runId = useRef(0);

  useEffect(() => {
    if (!dataset) return;
    const name = dataset.name;
    const request: AdminAnalyticsQuery = JSON.parse(bodyKey);
    const baseline: AnalyticsWindow | null = JSON.parse(baselineKey);
    const id = ++runId.current;

    const query = (payload: AdminAnalyticsQuery) =>
      transport.queryDataset(name, payload);

    const execute = async () => {
      setRunning(true);
      setError(undefined);
      try {
        const ungrouped: AdminAnalyticsQuery = {
          ...request,
          groupBy: undefined,
          orderBy: undefined,
          limit: undefined,
        };
        const [rowsResult, totalsResult, baselineResult] = await Promise.all([
          query(request),
          query(ungrouped),
          baseline
            ? query({
                ...ungrouped,
                since: undefined,
                until: undefined,
                from: undefined,
                to: undefined,
                ...analyticsWindowBody(baseline),
              })
            : Promise.resolve(undefined),
        ]);
        const keys = analyticsSelectKeys(request.select);

        // The group population is only worth asking for when the result
        // actually filled the limit: below it, nothing was cut and the count
        // is the row count.
        const limit = request.limit ?? ANALYTICS_MAX_LIMIT;
        const filled = rowsResult.rows.length >= limit;
        const scope =
          filled && limit < ANALYTICS_MAX_LIMIT
            ? await query({
                ...request,
                select: Object.fromEntries(
                  Object.entries(request.select).slice(0, 1),
                ),
                limit: ANALYTICS_MAX_LIMIT,
              })
            : undefined;
        const groupCount = scope ? scope.rows.length : rowsResult.rows.length;

        if (id !== runId.current) return;
        setResult({
          rows: rowsResult.rows as AnalyticsRow[],
          groupCount,
          groupCountCapped: groupCount >= ANALYTICS_MAX_LIMIT,
          totals: sumRow(totalsResult.rows[0], keys),
          baseline: baselineResult
            ? sumRow(baselineResult.rows[0], keys)
            : null,
          estimated: rowsResult.estimated,
          sampleInterval: rowsResult.sampleInterval,
          coarsened: !!rowsResult.coarsened || !!totalsResult.coarsened,
          window: request.from
            ? { from: request.from, to: request.to ?? "", instant: true }
            : {
                from: request.since ?? "",
                to: request.until ?? request.since ?? "",
              },
          baselineWindow: baseline,
          groupBy: request.groupBy ?? [],
          measures: keys,
          labels: Object.fromEntries(
            keys.map((key) => [key, analyticsKeyLabel(dataset, key)]),
          ),
          folds: Object.fromEntries(
            keys.map((key) => [key, analyticsKeyFold(dataset, key).fold]),
          ),
          orderBy:
            request.orderBy ??
            analyticsDefaultOrderBy(request.groupBy ?? [], keys[0] ?? ""),
          limit,
          body: request,
        });
      } catch (cause) {
        if (id !== runId.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (id === runId.current) setRunning(false);
      }
    };

    // Debounced: toggling three measures is one query, not three.
    const timer = setTimeout(() => void execute(), 220);
    return () => clearTimeout(timer);
  }, [transport, dataset, bodyKey, baselineKey, nonce]);

  const patch = useCallback((next: Partial<AnalyticsQueryState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const selectDataset = useCallback((name: string) => {
    // Nothing survives a dataset change: measures, group keys, filters, sort,
    // shape and axis are all names from a schema the new dataset has never
    // heard of.
    setState(initialQueryState(name));
    setViewState((current) => ({ ...emptyView, view: current.view }));
    setResult(undefined);
    setError(undefined);
  }, []);

  const toggleMeasure = useCallback(
    (name: string) => {
      setState((current) => {
        const active = current.measures ?? measures;
        // At least one measure must stay selected: clicking the last active
        // one is a no-op, not an empty select the backend would reject.
        const next = active.includes(name)
          ? active.filter((entry) => entry !== name)
          : measures.filter(
              (entry) => active.includes(entry) || entry === name,
            );
        return next.length > 0 ? { ...current, measures: next } : current;
      });
    },
    [measures],
  );

  const toggleGroupBy = useCallback((name: string) => {
    setState((current) => ({
      ...current,
      groupBy: current.groupBy.includes(name)
        ? current.groupBy.filter((key) => key !== name)
        : [...current.groupBy, name],
      // The sort key was chosen against the old grouping; it may not be a
      // column any more.
      orderBy: null,
    }));
  }, []);

  const sortBy = useCallback((key: string) => {
    setState((current) => ({
      ...current,
      orderBy: {
        key,
        direction:
          current.orderBy?.key === key && current.orderBy.direction === "desc"
            ? "asc"
            : "desc",
      },
    }));
  }, []);

  const applyFilter = useCallback((dim: string, values: string[]) => {
    setState((current) => {
      const rest = current.filters.filter((filter) => filter.dim !== dim);
      return {
        ...current,
        filters: values.length > 0 ? [...rest, { dim, values }] : rest,
      };
    });
  }, []);

  const removeFilter = useCallback((dim: string) => {
    setState((current) => ({
      ...current,
      filters: current.filters.filter((filter) => filter.dim !== dim),
    }));
  }, []);

  return {
    dataset,
    state,
    viewState,
    window,
    baselineWindow,
    dimensions,
    measures,
    activeMeasures,
    grains,
    advancedDirty: analyticsAdvancedDirty(state),
    body,
    result,
    running,
    error,
    selectDataset,
    toggleMeasure,
    setDays: (days) => patch({ days, instant: null }),
    // A new instant range re-picks the time axis: the finest grain it
    // allows, so "last 15 minutes" opens on minutes, not on one day bar.
    setInstant: (instant) =>
      setState((current) => {
        if (!dataset) return { ...current, instant };
        const next = { ...current, instant };
        const grain = analyticsDefaultGrain(
          dataset,
          analyticsStateWindow(now, next, 0),
          now,
        );
        const rest = current.groupBy.filter(
          (key) => !analyticsIsTimeGrain(key),
        );
        const hadGrain = rest.length !== current.groupBy.length;
        return {
          ...next,
          groupBy: hadGrain && grain ? [grain, ...rest] : current.groupBy,
          orderBy: null,
        };
      }),
    setUntilMode: (untilMode) => patch({ untilMode }),
    setCompare: (compare) => patch({ compare }),
    toggleGroupBy,
    setLimit: (limit) => patch({ limit }),
    sortBy,
    applyFilter,
    removeFilter,
    setView: (view) => setViewState((current) => ({ ...current, view })),
    setShape: (shape) => setViewState((current) => ({ ...current, shape })),
    // Picking an axis drops the shape: the shapes a grouping supports are
    // decided by which key is on the x-axis, so the old one may no longer be
    // one of them.
    setAxis: (axis) =>
      setViewState((current) => ({ ...current, axis, shape: null })),
    setChartMeasure: (chartMeasure) =>
      setViewState((current) => ({ ...current, chartMeasure })),
    reset: () => {
      setState(initialQueryState(selected));
      setViewState((current) => ({ ...emptyView, view: current.view }));
    },
    run: () => setNonce((value) => value + 1),
  };
};

/**
 * The measures of an ungrouped result row, as numbers.
 *
 * A missing row means nothing matched, which is not the same as a measured
 * zero. But by the time it reaches a total card it has to be a number, and
 * the empty state above the cards is what carries the difference.
 */
const sumRow = (
  row: Record<string, string | number | null> | undefined,
  measures: string[],
): Record<string, number> =>
  Object.fromEntries(
    measures.map((measure) => [measure, Number(row?.[measure] ?? 0)]),
  );
