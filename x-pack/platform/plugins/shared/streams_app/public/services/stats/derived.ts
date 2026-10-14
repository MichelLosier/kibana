/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ResourceStats, StatsMetric, StatsResourceType } from './types';

/**
 * Derived values for the UI. Choices recorded in the spike findings:
 * - Destination rate counts `success` items. Failures and refusals are not delivered.
 * - Step rate counts the `out` direction, items that left the step.
 * Both divide by the server window, so a config change that shortens real data
 * makes the rate read low.
 */

const NOT_DELIVERED = ['failure', 'refused'];

const isReady = (stats: ResourceStats) => stats.status === 'ready' || stats.status === 'stale';

const rows = (stats: ResourceStats, name: string, aggregation: string): StatsMetric[] =>
  stats.metrics.filter((row) => row.name === name && row.aggregation === aggregation);

/** Items per second, or undefined when there is no usable data. Zero is a real value. */
export const getEventsPerSecond = (
  stats: ResourceStats,
  type: StatsResourceType
): number | undefined => {
  if (!isReady(stats) || !stats.windowSeconds) return undefined;
  const items = rows(stats, 'items', 'sum').filter((row) => {
    const outcome = row.dimensions?.outcome;
    const direction = row.dimensions?.direction;
    if (outcome !== undefined && NOT_DELIVERED.includes(outcome)) return false;
    return type === 'step' ? direction === 'out' : true;
  });
  if (items.length === 0) return undefined;
  return items.reduce((total, row) => total + row.value, 0) / stats.windowSeconds;
};

/** Average duration in seconds, or undefined. Never average the averages of several rows. */
export const getAverageDurationSeconds = (stats: ResourceStats): number | undefined => {
  if (!isReady(stats)) return undefined;
  return rows(stats, 'duration', 'avg')[0]?.value;
};

/** `3.7k eps`, `12 eps`, `0 eps`. */
export const formatEventsPerSecond = (eps: number): string => {
  if (eps >= 1_000_000) return `${trim(eps / 1_000_000)}M eps`;
  if (eps >= 1_000) return `${trim(eps / 1_000)}k eps`;
  if (eps >= 10 || eps === 0) return `${Math.round(eps)} eps`;
  if (eps >= 1) return `${trim(eps)} eps`;
  // Below 1 eps keep two decimals so a quiet unit does not read as zero.
  if (eps < 0.01) return '<0.01 eps';
  return `${Math.round(eps * 100) / 100} eps`;
};

/** `8ms`, `1.2s`, `77µs`. */
export const formatDuration = (seconds: number): string => {
  if (seconds >= 1) return `${trim(seconds)}s`;
  if (seconds >= 0.001) return `${Math.round(seconds * 1000)}ms`;
  return `${Math.round(seconds * 1_000_000)}µs`;
};

const trim = (value: number): string => String(Math.round(value * 10) / 10);
