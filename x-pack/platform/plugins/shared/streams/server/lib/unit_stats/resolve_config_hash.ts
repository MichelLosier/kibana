/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import {
  CONFIG_HASH_FIELD,
  START_TIMESTAMP_FIELD,
  TIMESTAMP_FIELD,
  UNIT_ID_FIELDS,
  UNIT_STATS_QUERY_TIMEOUT,
  UNIT_STATS_STREAM,
} from './constants';

export interface StatsWindow {
  start: string;
  end: string;
}

const baseRequest = {
  index: UNIT_STATS_STREAM,
  ignore_unavailable: false,
  allow_no_indices: false,
  timeout: UNIT_STATS_QUERY_TIMEOUT,
  track_total_hits: false,
} as const;

const unitFilter = (unitId: string): estypes.QueryDslQueryContainer => ({
  bool: {
    should: UNIT_ID_FIELDS.map((field) => ({ term: { [field]: unitId } })),
    minimum_should_match: 1,
  },
});

/** Unit, window and optional hash. The filter every stats search shares. */
export const buildUnitFilter = ({
  unitId,
  window,
  configHash,
}: {
  unitId: string;
  window: StatsWindow;
  configHash?: string;
}): estypes.QueryDslQueryContainer[] => [
  unitFilter(unitId),
  { range: { [TIMESTAMP_FIELD]: { gte: window.start, lt: window.end } } },
  ...(configHash ? [{ term: { [CONFIG_HASH_FIELD]: configHash } }] : []),
];

/** Finds the newest document for the unit in the window and reads its config hash. */
export const buildLatestHashRequest = ({
  unitId,
  window,
}: {
  unitId: string;
  window: StatsWindow;
}): estypes.SearchRequest => ({
  ...baseRequest,
  size: 1,
  sort: [{ [TIMESTAMP_FIELD]: 'desc' }],
  query: { bool: { filter: buildUnitFilter({ unitId, window }) } },
  _source: false,
  fields: [CONFIG_HASH_FIELD],
});

export const readLatestHash = (response: estypes.SearchResponse): string | undefined => {
  const value = response.hits.hits[0]?.fields?.[CONFIG_HASH_FIELD];
  const hash = Array.isArray(value) ? value[0] : undefined;
  return typeof hash === 'string' ? hash : undefined;
};

/**
 * The earliest `start_timestamp` for this unit and hash over all time. A rate divides
 * by the time the data covers, so a new config does not read low.
 */
export const buildEarliestStartRequest = ({
  unitId,
  configHash,
}: {
  unitId: string;
  configHash: string;
}): estypes.SearchRequest => ({
  ...baseRequest,
  size: 0,
  query: {
    bool: { filter: [unitFilter(unitId), { term: { [CONFIG_HASH_FIELD]: configHash } }] },
  },
  aggs: { earliest: { min: { field: START_TIMESTAMP_FIELD } } },
});

/** Epoch ms of the earliest start, or undefined when no document matches. */
export const readEarliestStartMs = (response: estypes.SearchResponse): number | undefined => {
  const aggregation = response.aggregations?.earliest as { value: number | null } | undefined;
  return typeof aggregation?.value === 'number' ? aggregation.value : undefined;
};
