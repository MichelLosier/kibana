/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import {
  CONFIG_HASH_FIELD,
  TIMESTAMP_FIELD,
  UNIT_ID_FIELDS,
  UNIT_STATS_QUERY_TIMEOUT,
  UNIT_STATS_STREAM,
} from './constants';

export interface StatsWindow {
  start: string;
  end: string;
}

export const buildUnitFilter = ({
  unitId,
  window,
  configHash,
}: {
  unitId: string;
  window: StatsWindow;
  configHash?: string;
}): estypes.QueryDslQueryContainer[] => [
  {
    bool: {
      should: UNIT_ID_FIELDS.map((field) => ({ term: { [field]: unitId } })),
      minimum_should_match: 1,
    },
  },
  { range: { [TIMESTAMP_FIELD]: { gte: window.start, lt: window.end } } },
  ...(configHash ? [{ term: { [CONFIG_HASH_FIELD]: configHash } }] : []),
];

/** Finds the newest document for the unit in the window and reads its config hash. */
export const buildConfigHashRequest = ({
  unitId,
  window,
}: {
  unitId: string;
  window: StatsWindow;
}): estypes.SearchRequest => ({
  index: UNIT_STATS_STREAM,
  ignore_unavailable: false,
  allow_no_indices: false,
  timeout: UNIT_STATS_QUERY_TIMEOUT,
  size: 1,
  track_total_hits: false,
  sort: [{ [TIMESTAMP_FIELD]: 'desc' }],
  query: { bool: { filter: buildUnitFilter({ unitId, window }) } },
  _source: false,
  fields: [CONFIG_HASH_FIELD],
});

export const readConfigHash = (response: estypes.SearchResponse): string | undefined => {
  const fields = response.hits.hits[0]?.fields;
  const value = fields?.[CONFIG_HASH_FIELD];
  const hash = Array.isArray(value) ? value[0] : undefined;
  return typeof hash === 'string' ? hash : undefined;
};
