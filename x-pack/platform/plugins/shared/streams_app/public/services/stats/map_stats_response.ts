/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StreamsUnit } from '@kbn/streams-schema';
import type { ComponentStats, StatsComponentRef, StatsError } from './types';
import { statsKey } from './types';

/** The only file that maps between UI domain types and the wire shape. */

export const toWireRequest = (components: StatsComponentRef[]): StreamsUnit.StatsRequest => ({
  components: components.map(({ kind, id }) => ({ kind, id })),
});

const emptyEntry = (now: number, error?: StatsError): ComponentStats => ({
  phase: 'loaded',
  eventsPerSecond: null,
  averageSeconds: null,
  totalEvents: null,
  lastUpdated: now,
  ...(error ? { error } : {}),
});

/**
 * Maps the keyed response to entries. A response-level error is copied onto every
 * component that has none of its own. A component that is missing from the response
 * is a problem, not zero.
 */
export const fromWireResponse = (
  response: StreamsUnit.StatsResponse,
  requested: StatsComponentRef[],
  now: number
): Record<string, ComponentStats> => {
  const { window } = response.meta;
  const windowMs = { start: Date.parse(window.start), end: Date.parse(window.end) };
  const entries: Record<string, ComponentStats> = {};

  for (const ref of requested) {
    // Own-property reads only: an id such as `constructor` is valid.
    const group =
      ref.kind === 'destination'
        ? response.components.destinations
        : response.components.processors;
    const result = Object.hasOwn(group, ref.id) ? group[ref.id] : undefined;
    const error = result?.error ?? response.error;

    if (!result) {
      entries[statsKey(ref)] = emptyEntry(
        now,
        error ?? { code: 'error', reason: 'No result for this component.' }
      );
    } else if (ref.kind === 'destination') {
      const destination = result as StreamsUnit.StatsDestinationResult;
      const incoming = destination.events.incoming;
      entries[statsKey(ref)] = {
        phase: 'loaded',
        eventsPerSecond: incoming.rate.value,
        averageSeconds: destination.latency.average.value,
        totalEvents: incoming.total.value,
        series: {
          bucketMs: incoming.series.bucket_ms,
          points: incoming.series.points.map((point) => ({
            x: Date.parse(point.start),
            value: point.value,
          })),
          window: windowMs,
        },
        lastUpdated: now,
        ...(error ? { error } : {}),
      };
    } else {
      const processor = result as StreamsUnit.StatsProcessorResult;
      entries[statsKey(ref)] = {
        phase: 'loaded',
        eventsPerSecond: processor.events.incoming.rate.value,
        averageSeconds: processor.processing_duration.average.value,
        totalEvents: null,
        lastUpdated: now,
        ...(error ? { error } : {}),
      };
    }
  }

  return entries;
};

/** Marks every requested component with one error. Used when the whole call fails. */
export const entriesForFailure = (
  components: StatsComponentRef[],
  error: StatsError,
  now: number
): Record<string, ComponentStats> =>
  Object.fromEntries(components.map((ref) => [statsKey(ref), emptyEntry(now, error)]));
