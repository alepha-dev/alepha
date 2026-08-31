import type {
  AdminAnalyticsController,
  AdminAnalyticsQuery,
  AdminDatasetDescriptor,
} from "alepha/api/analytics";
import { DateTimeProvider } from "alepha/datetime";
import { useAlepha, useClient } from "alepha/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ANALYTICS_MAX_LIMIT,
  analyticsActiveMeasures,
  analyticsAdvancedDirty,
  analyticsDefaultOrderBy,
  analyticsDimensions,
  analyticsHotDays,
  analyticsHourAllowed,
  analyticsMeasures,
  analyticsRequestBody,
  analyticsToday,
  analyticsWindow,
} from "./analyticsModel.ts";
import type {
  AnalyticsChartShape,
  AnalyticsCompareMode,
  AnalyticsQueryState,
  AnalyticsRow,
  AnalyticsRunResult,
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
  measures: string[];
  activeMeasures: string[];
  hotDays: number | null;
  hourAllowed: boolean;
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
): AnalyticsQueryApi => {
  const client = useClient<AdminAnalyticsController>();
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
  // "yesterday" instead of querying the previous day forever.
  const today = useMemo(
    () => analyticsToday(dateTime.nowMillis()),
    [dateTime, nonce],
  );

  const window = useMemo(
    () => analyticsWindow(today, state, 0),
    [today, state],
  );
  const baselineWindow = useMemo(
    () => (state.compare === "off" ? null : analyticsWindow(today, state, 1)),
    [today, state],
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

  const hotDays = dataset ? analyticsHotDays(dataset) : null;
  const hourAllowed = dataset
    ? analyticsHourAllowed(dataset, state.days)
    : true;

  const body = useMemo(
    () =>
      dataset
        ? analyticsRequestBody(dataset, state, window)
        : ({ since: window.from, select: {} } as AdminAnalyticsQuery),
    [dataset, state, window],
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
      client.queryDataset({ params: { name }, body: payload });

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
            ? query({ ...ungrouped, since: baseline.from, until: baseline.to })
            : Promise.resolve(undefined),
        ]);

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
          totals: sumRow(totalsResult.rows[0], Object.keys(request.select)),
          baseline: baselineResult
            ? sumRow(baselineResult.rows[0], Object.keys(request.select))
            : null,
          estimated: rowsResult.estimated,
          sampleInterval: rowsResult.sampleInterval,
          window: { from: request.since, to: request.until ?? request.since },
          baselineWindow: baseline,
          groupBy: request.groupBy ?? [],
          measures: Object.keys(request.select),
          orderBy:
            request.orderBy ??
            analyticsDefaultOrderBy(
              request.groupBy ?? [],
              Object.keys(request.select)[0] ?? "",
            ),
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
  }, [client, dataset, bodyKey, baselineKey, nonce]);

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
    hotDays,
    hourAllowed,
    advancedDirty: analyticsAdvancedDirty(state),
    body,
    result,
    running,
    error,
    selectDataset,
    toggleMeasure,
    setDays: (days) => patch({ days }),
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
  row: Record<string, string | number> | undefined,
  measures: string[],
): Record<string, number> =>
  Object.fromEntries(
    measures.map((measure) => [measure, Number(row?.[measure] ?? 0)]),
  );
