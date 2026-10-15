/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import {
  formatDuration,
  formatEventsPerSecond,
  getAverageSeconds,
  getEventsPerSecond,
} from './derived';
import { countRender } from './render_counter';
import { useRegisterStats, useStatsFor } from './stats_context';
import type { ComponentStats, StatsComponentRef, StatsKind } from './types';

export const NO_STATS_TEXT = '–';
export const LOADING_STATS_TEXT = '…';

/**
 * Plain text for a stats slice. Rate and latency joined by a dot, for example
 * `18.4k eps · 15ms`. Loading shows an ellipsis. A null value, an error (any code,
 * known or not) and idle show a dash. Never zero unless the data says zero.
 */
export const formatStatsText = (
  stats: ComponentStats,
  parts: { rate?: boolean; latency?: boolean } = { rate: true, latency: true }
): string => {
  if (stats.phase === 'loading') return LOADING_STATS_TEXT;
  const eps = parts.rate ? getEventsPerSecond(stats) : undefined;
  const seconds = parts.latency ? getAverageSeconds(stats) : undefined;
  const texts = [
    eps === undefined ? undefined : formatEventsPerSecond(eps),
    seconds === undefined ? undefined : formatDuration(seconds),
  ].filter((text): text is string => text !== undefined);
  return texts.length > 0 ? texts.join(' · ') : NO_STATS_TEXT;
};

/** Registers on mount, unregisters on unmount. The manager adds the grace period. */
export const StatsText = ({
  kind,
  id,
  parts,
  debugLabel,
}: {
  kind: StatsKind;
  id: string;
  parts?: { rate?: boolean; latency?: boolean };
  debugLabel?: string;
}) => {
  const ref = useMemo<StatsComponentRef>(() => ({ kind, id }), [kind, id]);
  const refs = useMemo(() => [ref], [ref]);
  useRegisterStats(refs);
  const stats = useStatsFor(ref);
  countRender(`${debugLabel ?? kind}:${id}`);

  return (
    <span
      data-test-subj="streamsStatsText"
      data-stats-phase={stats.phase}
      data-stats-error={stats.error?.code}
    >
      {formatStatsText(stats, parts)}
    </span>
  );
};
