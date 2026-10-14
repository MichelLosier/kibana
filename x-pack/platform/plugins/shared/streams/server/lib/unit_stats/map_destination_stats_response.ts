/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StreamsUnit } from '@kbn/streams-schema';
import { METRIC_UNITS } from './constants';
import { mapDurationRows, type DurationBucket } from './duration_stats';

interface SumBucket {
  total?: { value: number | null };
}

interface DestinationBucket {
  key: string;
  doc_count: number;
  items?: {
    doc_count: number;
    by_outcome?: { buckets: Array<SumBucket & { key: string; doc_count: number }> };
  };
  bytes?: SumBucket & { doc_count: number };
  duration?: DurationBucket;
}

export interface DestinationStatsAggregations {
  by_id?: { buckets: DestinationBucket[] };
}

/**
 * Maps aggregation buckets to metric rows by destination id. An id with no
 * bucket, or a bucket with no rows, is absent from the result. The caller
 * turns that into `no_data`. The mapper never invents a zero.
 */
export const mapDestinationStatsResponse = (
  aggregations: DestinationStatsAggregations | undefined
): Map<string, StreamsUnit.StatsMetric[]> => {
  const rowsById = new Map<string, StreamsUnit.StatsMetric[]>();

  for (const bucket of aggregations?.by_id?.buckets ?? []) {
    const rows: StreamsUnit.StatsMetric[] = [];

    for (const outcome of bucket.items?.by_outcome?.buckets ?? []) {
      if (outcome.doc_count > 0) {
        rows.push({
          name: 'items',
          aggregation: 'sum',
          value: outcome.total?.value ?? 0,
          unit: METRIC_UNITS.items,
          dimensions: { outcome: String(outcome.key) },
        });
      }
    }

    if (bucket.bytes && bucket.bytes.doc_count > 0) {
      rows.push({
        name: 'bytes',
        aggregation: 'sum',
        value: bucket.bytes.total?.value ?? 0,
        unit: METRIC_UNITS.bytes,
      });
    }

    rows.push(...mapDurationRows(bucket.duration));

    if (rows.length > 0) {
      rowsById.set(String(bucket.key), rows);
    }
  }

  return rowsById;
};
