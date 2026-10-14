/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Temporary render counters for the spike. Turn on in the browser console:
 * `window.__STREAMS_STATS_DEBUG__ = true`. Read the totals with
 * `window.__streamsStatsRenders`.
 */
declare global {
  interface Window {
    __streamsStatsRenders?: Record<string, number>;
  }
}

/** True when `window.__STREAMS_STATS_DEBUG__` is set or localStorage `streamsStatsDebug` is `1`. */
export const isStatsDebug = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (window.__STREAMS_STATS_DEBUG__) return true;
  try {
    return window.localStorage.getItem('streamsStatsDebug') === '1';
  } catch {
    return false;
  }
};

export const countRender = (label: string) => {
  if (!isStatsDebug()) return;
  const counts = (window.__streamsStatsRenders ??= {});
  counts[label] = (counts[label] ?? 0) + 1;
  // eslint-disable-next-line no-console
  console.debug(`[streams-stats] render ${label} #${counts[label]}`);
};
