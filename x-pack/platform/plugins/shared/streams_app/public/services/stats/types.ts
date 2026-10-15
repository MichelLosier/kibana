/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * UI domain types for stats. No wire names live here. Only `map_stats_response.ts`
 * knows the HTTP shape, so an API rename changes one file. The UI does no division:
 * the server sends rates, totals, series and seconds.
 */

export type StatsKind = 'destination' | 'processor';

export interface StatsComponentRef {
  kind: StatsKind;
  id: string;
}

/** `code` is an open string. Treat an unknown code as a generic problem. */
export interface StatsError {
  code: string;
  reason: string;
}

export interface StatsSeriesPoint {
  /** Bucket start in epoch ms. */
  x: number;
  value: number;
}

export interface StatsSeries {
  bucketMs: number;
  points: readonly StatsSeriesPoint[];
  /** The query window in epoch ms, for the chart domain. */
  window: { start: number; end: number };
}

export interface ComponentStats {
  /**
   * `idle` before any request, `loading` for the first load, `loaded` after a response.
   * A loaded entry can still carry an error and null values.
   */
  phase: 'idle' | 'loading' | 'loaded';
  /** A problem with this component, or the response-level error copied onto it. */
  error?: StatsError;
  /** Items per second. null means no data. */
  eventsPerSecond: number | null;
  /** Destination: seconds per bulk request. Processor: seconds per event. null means no data. */
  averageSeconds: number | null;
  /** Destinations only. The sum of the series points. */
  totalEvents: number | null;
  /** Destinations only. */
  series?: StatsSeries;
  /** True when the last refresh failed and these values are from an earlier response. */
  stale?: boolean;
  lastUpdated?: number;
}

export interface StatsFetchResult {
  /** Keyed by `statsKey(ref)`. */
  entries: Record<string, ComponentStats>;
}

export interface StatsClient {
  fetchStats(args: {
    components: StatsComponentRef[];
    signal: AbortSignal;
  }): Promise<StatsFetchResult>;
}

export const IDLE_STATS: ComponentStats = Object.freeze({
  phase: 'idle',
  eventsPerSecond: null,
  averageSeconds: null,
  totalEvents: null,
});

/** Ids allow only lowercase letters, digits and hyphens, so NUL cannot appear in one. */
export const statsKey = (ref: StatsComponentRef): string => [ref.kind, ref.id].join('\u0000');
