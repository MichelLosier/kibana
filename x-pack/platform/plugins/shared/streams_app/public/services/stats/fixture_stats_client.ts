/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StreamsUnit } from '@kbn/streams-schema';
import { fromWireResponse, toWireRequest } from './map_stats_response';
import type { StatsClient } from './types';

const WINDOW = { start: '2026-10-14T11:45:00.000Z', end: '2026-10-14T12:00:00.000Z' };
const RATE_UNIT = '{item}/s';

const noDestination = (error?: StreamsUnit.StatsError): StreamsUnit.StatsDestinationResult => ({
  ...(error ? { error } : {}),
  latency: { average: { value: null } },
  events: {
    incoming: {
      total: { value: null },
      rate: { value: null, unit: RATE_UNIT },
      series: { bucket_ms: 60_000, points: [] },
    },
  },
});

const noProcessor = (error?: StreamsUnit.StatsError): StreamsUnit.StatsProcessorResult => ({
  ...(error ? { error } : {}),
  processing_duration: { average: { value: null } },
  events: { incoming: { rate: { value: null, unit: RATE_UNIT } } },
});

/** 15 one minute points of 1,104 items: a total of 16,560 over 900 s is 18.4 eps. */
const series15 = {
  bucket_ms: 60_000,
  points: Array.from({ length: 15 }, (_, i) => ({
    start: new Date(Date.parse(WINDOW.start) + i * 60_000).toISOString(),
    value: 1104,
  })),
};

/**
 * Wire-shaped fixture response, passed through the same mapper as a real response.
 * Special ids: `es-dev` and `empty` have no data, `forbidden` and `future-code` carry
 * a component error, and `not-in-unit` is `not_found`.
 */
export const fixtureStatsResponse = (
  components: StreamsUnit.StatsComponentRef[],
  responseError?: StreamsUnit.StatsError
): StreamsUnit.StatsResponse => {
  const destinations: StreamsUnit.StatsResponse['components']['destinations'] = {};
  const processors: StreamsUnit.StatsResponse['components']['processors'] = {};

  const errorFor = (id: string): StreamsUnit.StatsError | undefined =>
    id === 'forbidden'
      ? { code: 'forbidden', reason: 'The current user cannot read the stats stream.' }
      : id === 'future-code'
      ? { code: 'a_future_code', reason: 'Something new went wrong.' }
      : id === 'not-in-unit'
      ? { code: 'not_found', reason: 'No component with this id in the unit.' }
      : undefined;
  const quiet = (id: string) => responseError !== undefined || ['es-dev', 'empty'].includes(id);

  for (const { kind, id } of components) {
    const error = errorFor(id);
    if (kind === 'destination') {
      destinations[id] =
        error || quiet(id)
          ? noDestination(error)
          : {
              latency: { average: { value: 0.015 } },
              events: {
                incoming: {
                  total: { value: 16560 },
                  rate: { value: 18.4, unit: RATE_UNIT },
                  series: series15,
                },
              },
            };
    } else {
      processors[id] =
        error || quiet(id)
          ? noProcessor(error)
          : {
              processing_duration: { average: { value: 0.008 } },
              events: { incoming: { rate: { value: 3.7, unit: RATE_UNIT } } },
            };
    }
  }

  return {
    ...(responseError ? { error: responseError } : {}),
    components: { destinations, processors },
    meta: { window: WINDOW, config_hash: 'fixture' },
  };
};

export const createFixtureStatsClient = ({
  delayMs = 0,
  responseError,
}: { delayMs?: number; responseError?: StreamsUnit.StatsError } = {}): StatsClient & {
  calls: Array<{ count: number }>;
} => {
  const calls: Array<{ count: number }> = [];
  return {
    calls,
    fetchStats: async ({ components, signal }) => {
      calls.push({ count: components.length });
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      signal.throwIfAborted();
      const wire = toWireRequest(components).components ?? [];
      return {
        entries: fromWireResponse(
          fixtureStatsResponse(wire, responseError),
          components,
          Date.now()
        ),
      };
    },
  };
};
