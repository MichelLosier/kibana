/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import {
  DESTINATION_BYTES_FIELD,
  DESTINATION_ID_FIELD,
  DESTINATION_ITEMS_FIELD,
  MAX_OUTCOME_BUCKETS,
  OUTCOME_FIELD,
  UNIT_STATS_QUERY_TIMEOUT,
  UNIT_STATS_STREAM,
} from './constants';
import { buildUnitFilter, type StatsWindow } from './resolve_config_hash';

/**
 * One search for all destination ids. `size: 0` and a terms aggregation per id.
 * Each metric sits under a `filter` on field existence, so the mapper can tell
 * an empty bucket from a sum of zero.
 */
export const buildDestinationStatsRequest = ({
  unitId,
  window,
  ids,
  configHash,
}: {
  unitId: string;
  window: StatsWindow;
  ids: string[];
  configHash?: string;
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
        { terms: { [DESTINATION_ID_FIELD]: ids } },
      ],
    },
  },
  aggs: {
    by_id: {
      terms: { field: DESTINATION_ID_FIELD, size: Math.max(ids.length, 1) },
      aggs: {
        items: {
          filter: { exists: { field: DESTINATION_ITEMS_FIELD } },
          aggs: {
            by_outcome: {
              terms: { field: OUTCOME_FIELD, size: MAX_OUTCOME_BUCKETS },
              aggs: { total: { sum: { field: DESTINATION_ITEMS_FIELD } } },
            },
          },
        },
        bytes: {
          filter: { exists: { field: DESTINATION_BYTES_FIELD } },
          aggs: { total: { sum: { field: DESTINATION_BYTES_FIELD } } },
        },
      },
    },
  },
});
