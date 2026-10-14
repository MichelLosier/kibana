/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import type { StreamsUnit } from '@kbn/streams-schema';
import { METRIC_UNITS } from './constants';

/**
 * Duration rows, isolated so they can be dropped. Verified on Oct 14: `avg`,
 * `max` and `percentiles` all work on the exponential_histogram fields in the
 * local serverless Elasticsearch. The mapping has no `count` field.
 */

export const buildDurationAggregations = (
  field: string
): Record<string, estypes.AggregationsAggregationContainer> => ({
  duration: {
    filter: { exists: { field } },
    aggs: {
      avg: { avg: { field } },
      max: { max: { field } },
      p95: { percentiles: { field, percents: [95] } },
    },
  },
});

export interface DurationBucket {
  doc_count: number;
  avg?: { value: number | null };
  max?: { value: number | null };
  p95?: { values: Record<string, number | null> };
}

export const mapDurationRows = (bucket: DurationBucket | undefined): StreamsUnit.StatsMetric[] => {
  if (!bucket || bucket.doc_count <= 0) {
    return [];
  }

  const p95 = bucket.p95?.values ? Object.values(bucket.p95.values)[0] : null;
  const candidates: Array<[string, number | null | undefined]> = [
    ['avg', bucket.avg?.value],
    ['max', bucket.max?.value],
    ['p95', p95],
  ];

  return candidates.flatMap(([aggregation, value]) =>
    typeof value === 'number'
      ? [{ name: 'duration', aggregation, value, unit: METRIC_UNITS.duration }]
      : []
  );
};
