/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StreamsUnit } from '@kbn/streams-schema';
import { METRIC_UNITS } from './constants';
import { mapDurationRows, type DurationBucket } from './duration_stats';

interface DirectionAggregation {
  doc_count: number;
  by_direction?: {
    buckets: Array<{
      key: string;
      by_outcome?: {
        buckets: Array<{ key: string; doc_count: number; total?: { value: number | null } }>;
      };
    }>;
  };
}

interface ProcessorBucket {
  key: string;
  items?: DirectionAggregation;
  bytes?: DirectionAggregation;
  duration?: DurationBucket;
}

export interface ProcessorStatsAggregations {
  by_id?: { buckets: ProcessorBucket[] };
}

const mapDirectionRows = (
  name: 'items' | 'bytes',
  aggregation: DirectionAggregation | undefined
): StreamsUnit.StatsMetric[] => {
  if (!aggregation || aggregation.doc_count <= 0) {
    return [];
  }

  return (aggregation.by_direction?.buckets ?? []).flatMap((direction) =>
    (direction.by_outcome?.buckets ?? [])
      .filter((outcome) => outcome.doc_count > 0)
      .map((outcome) => ({
        name,
        aggregation: 'sum',
        value: outcome.total?.value ?? 0,
        unit: METRIC_UNITS[name],
        dimensions: { direction: String(direction.key), outcome: String(outcome.key) },
      }))
  );
};

/** Rows per authored step id. An id without rows is absent. The caller sets `no_data`. */
export const mapProcessorStatsResponse = (
  aggregations: ProcessorStatsAggregations | undefined
): Map<string, StreamsUnit.StatsMetric[]> => {
  const rowsById = new Map<string, StreamsUnit.StatsMetric[]>();

  for (const bucket of aggregations?.by_id?.buckets ?? []) {
    const rows = [
      ...mapDirectionRows('items', bucket.items),
      ...mapDirectionRows('bytes', bucket.bytes),
      ...mapDurationRows(bucket.duration),
    ];

    if (rows.length > 0) {
      rowsById.set(String(bucket.key), rows);
    }
  }

  return rowsById;
};
