/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import {
  DIRECTION_FIELD,
  MAX_DIRECTION_BUCKETS,
  MAX_OUTCOME_BUCKETS,
  OUTCOME_FIELD,
  PIPELINE_ID_FIELD,
  STEP_BYTES_FIELD,
  STEP_DURATION_FIELD,
  STEP_ID_FIELD,
  STEP_ITEMS_FIELD,
  UNIT_STATS_QUERY_TIMEOUT,
  UNIT_STATS_STREAM,
} from './constants';
import { buildDurationAggregations } from './duration_stats';
import { buildUnitFilter, type StatsWindow } from './resolve_config_hash';

const byDirectionAndOutcome = (field: string): estypes.AggregationsAggregationContainer => ({
  filter: { exists: { field } },
  aggs: {
    by_direction: {
      terms: { field: DIRECTION_FIELD, size: MAX_DIRECTION_BUCKETS },
      aggs: {
        by_outcome: {
          terms: { field: OUTCOME_FIELD, size: MAX_OUTCOME_BUCKETS },
          aggs: { total: { sum: { field } } },
        },
      },
    },
  },
});

/**
 * One search for processor ids. Without `pipelineId` it sums over every
 * pipeline that carries the step. With it, the query filters on the compiled
 * pipeline id (for example `main-route-0`), not the authored one.
 */
export const buildProcessorStatsRequest = ({
  unitId,
  window,
  ids,
  configHash,
  pipelineId,
}: {
  unitId: string;
  window: StatsWindow;
  ids: string[];
  configHash?: string;
  pipelineId?: string;
}): estypes.SearchRequest => ({
  index: UNIT_STATS_STREAM,
  ignore_unavailable: false,
  allow_no_indices: false,
  size: 0,
  track_total_hits: false,
  timeout: UNIT_STATS_QUERY_TIMEOUT,
  query: {
    bool: {
      filter: [
        ...buildUnitFilter({ unitId, window, configHash }),
        { terms: { [STEP_ID_FIELD]: ids } },
        ...(pipelineId ? [{ term: { [PIPELINE_ID_FIELD]: pipelineId } }] : []),
      ],
    },
  },
  aggs: {
    by_id: {
      terms: { field: STEP_ID_FIELD, size: Math.max(ids.length, 1) },
      aggs: {
        items: byDirectionAndOutcome(STEP_ITEMS_FIELD),
        bytes: byDirectionAndOutcome(STEP_BYTES_FIELD),
        ...buildDurationAggregations(STEP_DURATION_FIELD),
      },
    },
  },
});
