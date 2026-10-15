/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StreamsUnit } from '@kbn/streams-schema';
import { RATE_UNIT } from './constants';

interface DestinationBucket {
  key: string;
  items?: {
    doc_count: number;
    sum?: { value: number | null };
    series?: { buckets: Array<{ key: number; doc_count: number; sum?: { value: number | null } }> };
  };
  duration?: { doc_count: number; average?: { value: number | null } };
}

export interface DestinationStatsAggregations {
  by_id?: { buckets: DestinationBucket[] };
}

export const noDestinationStats = (bucketMs: number): StreamsUnit.StatsDestinationResult => ({
  latency: { average: { value: null } },
  events: {
    incoming: {
      total: { value: null },
      rate: { value: null, unit: RATE_UNIT },
      series: { bucket_ms: bucketMs, points: [] },
    },
  },
});

/** Rate over the seconds the data covers. Null when there is no covered time. */
export const toRate = (total: number, seconds: number | undefined): number | null =>
  seconds !== undefined && seconds > 0 ? total / seconds : null;

/**
 * Maps aggregation buckets to results by destination id. A destination has data when
 * an items document exists in the window. An id with no bucket is absent from the map,
 * and the caller fills null values. The mapper never invents a zero. `total` is the sum
 * of the points, so it always agrees with the bars.
 */
export const mapDestinationStatsResponse = ({
  aggregations,
  seconds,
  bucketMs,
}: {
  aggregations: DestinationStatsAggregations | undefined;
  seconds: number | undefined;
  bucketMs: number;
}): Map<string, StreamsUnit.StatsDestinationResult> => {
  const results = new Map<string, StreamsUnit.StatsDestinationResult>();

  for (const bucket of aggregations?.by_id?.buckets ?? []) {
    const result = noDestinationStats(bucketMs);
    const duration = bucket.duration;
    if (duration && duration.doc_count > 0 && typeof duration.average?.value === 'number') {
      result.latency.average.value = duration.average.value;
    }

    if (bucket.items && bucket.items.doc_count > 0) {
      const points = (bucket.items.series?.buckets ?? [])
        .filter((point) => point.doc_count > 0)
        .map((point) => ({
          start: new Date(point.key).toISOString(),
          value: point.sum?.value ?? 0,
        }));
      const total = points.reduce((sum, point) => sum + point.value, 0);
      result.events.incoming = {
        total: { value: total },
        rate: { value: toRate(total, seconds), unit: RATE_UNIT },
        series: { bucket_ms: bucketMs, points },
      };
    }

    results.set(String(bucket.key), result);
  }

  return results;
};
