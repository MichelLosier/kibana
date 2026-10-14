/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * UI domain types for stats. No wire names live here. Only `map_stats_response.ts`
 * knows the HTTP shape, so an API rename changes one file.
 */

export type StatsResourceType = 'destination' | 'step';

export interface StatsResourceRef {
  type: StatsResourceType;
  id: string;
  /** Steps only. The compiled pipeline id. Omit it to sum over every placement. */
  pipelineId?: string;
}

/** Open set. Consumers must treat an unknown value as `unavailable`. */
export type StatsStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'no_data'
  | 'unavailable'
  | 'forbidden'
  | 'stale'
  | (string & {});

export interface StatsMetric {
  name: string;
  aggregation: string;
  value: number;
  unit: string;
  dimensions?: Readonly<Record<string, string>>;
}

export interface ResourceStats {
  status: StatsStatus;
  /** Rows as the server sends them. Absent row means no documents. */
  metrics: readonly StatsMetric[];
  /** Length of the server window in seconds. Rates divide by it. */
  windowSeconds?: number;
  lastUpdated?: number;
  /** Raw server status or error text when the status was normalised. */
  reason?: string;
}

export interface StatsFetchResult {
  /** Keyed by `statsKey(ref)`. */
  entries: Record<string, ResourceStats>;
}

export interface StatsClient {
  fetchStats(args: {
    resources: StatsResourceRef[];
    signal: AbortSignal;
  }): Promise<StatsFetchResult>;
}

export const IDLE_STATS: ResourceStats = Object.freeze({ status: 'idle', metrics: [] });

/** Ids allow only lowercase letters, digits and hyphens, so NUL cannot appear in one. */
export const statsKey = (ref: StatsResourceRef): string =>
  [ref.type, ref.pipelineId ?? '', ref.id].join('\u0000');

const KNOWN_STATUSES = ['idle', 'loading', 'ready', 'no_data', 'unavailable', 'forbidden', 'stale'];

/** Returns the status when known and `unavailable` otherwise. Never `ready` for an unknown value. */
export const normalizeStatus = (status: string): StatsStatus =>
  KNOWN_STATUSES.includes(status) ? status : 'unavailable';
