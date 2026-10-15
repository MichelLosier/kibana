/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StreamsUnit } from '@kbn/streams-schema';
import { RATE_UNIT } from './constants';
import { toRate } from './map_destination_stats_response';

interface ProcessorBucket {
  key: string;
  items_in?: { doc_count: number; sum?: { value: number | null } };
  duration?: { doc_count: number; sum?: { value: number | null } };
}

export interface ProcessorStatsAggregations {
  by_id?: { buckets: ProcessorBucket[] };
}

export const noProcessorStats = (): StreamsUnit.StatsProcessorResult => ({
  processing_duration: { average: { value: null } },
  events: { incoming: { rate: { value: null, unit: RATE_UNIT } } },
});

/**
 * Seconds per event: the duration sum over the items `in` sum. Isolated so the math
 * stays in one place. Null when items `in` is zero or absent, or when no duration
 * document exists.
 */
export const averageSecondsPerEvent = (
  durationSum: number | null | undefined,
  itemsIn: number | null | undefined
): number | null =>
  typeof durationSum === 'number' && typeof itemsIn === 'number' && itemsIn > 0
    ? durationSum / itemsIn
    : null;

export const mapProcessorStatsResponse = ({
  aggregations,
  seconds,
}: {
  aggregations: ProcessorStatsAggregations | undefined;
  seconds: number | undefined;
}): Map<string, StreamsUnit.StatsProcessorResult> => {
  const results = new Map<string, StreamsUnit.StatsProcessorResult>();

  for (const bucket of aggregations?.by_id?.buckets ?? []) {
    const result = noProcessorStats();
    const hasItems = bucket.items_in !== undefined && bucket.items_in.doc_count > 0;
    const itemsIn = hasItems ? bucket.items_in?.sum?.value ?? 0 : undefined;

    if (hasItems && itemsIn !== undefined) {
      result.events.incoming.rate.value = toRate(itemsIn, seconds);
      if (bucket.duration && bucket.duration.doc_count > 0) {
        result.processing_duration.average.value = averageSecondsPerEvent(
          bucket.duration.sum?.value,
          itemsIn
        );
      }
    }

    results.set(String(bucket.key), result);
  }

  return results;
};
