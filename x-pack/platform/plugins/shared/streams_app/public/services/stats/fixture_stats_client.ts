/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StreamsUnit } from '@kbn/streams-schema';
import { fromWireResponse, toWireRequest } from './map_stats_response';
import type { StatsClient } from './types';

const WINDOW = {
  start: '2026-10-14T11:45:00.000Z',
  end: '2026-10-14T12:00:00.000Z',
};

const metric = (
  name: string,
  aggregation: string,
  value: number,
  unit: string,
  dimensions?: Record<string, string>
): StreamsUnit.StatsMetric => ({
  name,
  aggregation,
  value,
  unit,
  ...(dimensions ? { dimensions } : {}),
});

/**
 * Wire-shaped fixtures for the demo unit, passed through the same mapper as
 * real responses. 900 s window: 3,330 items is 3.7 eps, and a destination
 * with 16,560 items is 18.4 eps.
 */
export const fixtureStatsResponse = (
  resources: StreamsUnit.StatsResourceRef[]
): StreamsUnit.StatsResponse => ({
  meta: { window: WINDOW, config_hash: 'fixture', sampled: false, truncated: false },
  results: resources.map((ref): StreamsUnit.StatsResourceResult => {
    if (ref.id === 'es-dev' || ref.id === 'empty') {
      return { kind: ref.kind, id: ref.id, status: 'no_data', metrics: [] };
    }
    if (ref.id === 'forbidden') {
      return { kind: ref.kind, id: ref.id, status: 'forbidden', metrics: [] };
    }
    if (ref.id === 'future-status') {
      return { kind: ref.kind, id: ref.id, status: 'a_future_status', metrics: [] };
    }
    if (ref.kind === 'destination') {
      return {
        kind: ref.kind,
        id: ref.id,
        status: 'ok',
        metrics: [
          metric('items', 'sum', 16560, '{item}', { outcome: 'success' }),
          metric('items', 'sum', 12, '{item}', { outcome: 'failure' }),
          metric('bytes', 'sum', 9120456, 'By'),
          metric('duration', 'avg', 0.015, 's'),
          metric('duration', 'max', 0.04, 's'),
          metric('duration', 'p95', 0.031, 's'),
        ],
      };
    }
    return {
      kind: ref.kind,
      id: ref.id,
      ...(ref.pipeline_id ? { pipeline_id: ref.pipeline_id } : {}),
      status: 'ok',
      metrics: [
        metric('items', 'sum', 3330, '{item}', { direction: 'in', outcome: 'success' }),
        metric('items', 'sum', 3330, '{item}', { direction: 'out', outcome: 'success' }),
        metric('bytes', 'sum', 1807938, 'By', { direction: 'out', outcome: 'success' }),
        metric('duration', 'avg', 0.008, 's'),
      ],
    };
  }),
});

export const createFixtureStatsClient = ({
  delayMs = 0,
}: { delayMs?: number } = {}): StatsClient & { calls: Array<{ count: number }> } => {
  const calls: Array<{ count: number }> = [];
  return {
    calls,
    fetchStats: async ({ resources, signal }) => {
      calls.push({ count: resources.length });
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      signal.throwIfAborted();
      return {
        entries: fromWireResponse(
          fixtureStatsResponse(toWireRequest(resources).resources ?? []),
          Date.now()
        ),
      };
    },
  };
};
