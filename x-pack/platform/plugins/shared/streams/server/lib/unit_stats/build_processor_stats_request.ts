/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import {
  DIRECTION_FIELD,
  STEP_DURATION_FIELD,
  STEP_ID_FIELD,
  STEP_ITEMS_FIELD,
  UNIT_STATS_QUERY_TIMEOUT,
  UNIT_STATS_STREAM,
} from './constants';
import { buildUnitFilter, type StatsWindow } from './resolve_config_hash';

/**
 * One search for processor ids (telemetry calls them steps). It sums over every
 * placement: no pipeline id filter. Items count the `in` direction, all outcomes.
 * The duration is a `sum`, divided by the items sum in the mapper, so the average is
 * per event and not per batch (`avg` would be per batch).
 */
export const buildProcessorStatsRequest = ({
  unitId,
  window,
  ids,
  configHash,
}: {
  unitId: string;
  window: StatsWindow;
  ids: string[];
  configHash: string;
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
      ],
    },
  },
  aggs: {
    by_id: {
      terms: { field: STEP_ID_FIELD, size: Math.max(ids.length, 1) },
      aggs: {
        items_in: {
          filter: {
            bool: {
              filter: [
                { exists: { field: STEP_ITEMS_FIELD } },
                { term: { [DIRECTION_FIELD]: 'in' } },
              ],
            },
          },
          aggs: { sum: { sum: { field: STEP_ITEMS_FIELD } } },
        },
        duration: {
          filter: { exists: { field: STEP_DURATION_FIELD } },
          aggs: { sum: { sum: { field: STEP_DURATION_FIELD } } },
        },
      },
    },
  },
});
