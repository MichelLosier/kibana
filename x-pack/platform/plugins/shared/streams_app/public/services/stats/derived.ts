/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ComponentStats } from './types';

/**
 * Display helpers. The server sends rates and averages in seconds, so there is no
 * division here. A null value is "no data" and renders as a dash, never a number.
 */

/** Items per second, or undefined when there is no usable number. Zero is a real value. */
export const getEventsPerSecond = (stats: ComponentStats): number | undefined =>
  stats.phase === 'loaded' && !stats.error ? stats.eventsPerSecond ?? undefined : undefined;

/** Seconds, or undefined. Destination: per bulk request. Processor: per event. */
export const getAverageSeconds = (stats: ComponentStats): number | undefined =>
  stats.phase === 'loaded' && !stats.error ? stats.averageSeconds ?? undefined : undefined;

/** `3.7k eps`, `12 eps`, `0.33 eps`, `<0.01 eps`, `0 eps`. */
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
