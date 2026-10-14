/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Stream, field names and the window for unit stats, in one place.
 *
 * The stream was renamed on Oct 12 (it was `metrics-streams.metrics.otel-default`).
 * The resource attributes changed on Oct 14 from `unit_id` to `unit.id`. Older
 * data keeps the old names, so the unit id filter accepts both.
 */

/** Query the exact name. A wildcard hides both a 403 and a missing stream. */
export const UNIT_STATS_STREAM = 'metrics-streams.otel-default';

export const UNIT_STATS_WINDOW_MS = 15 * 60 * 1000;

export const UNIT_STATS_QUERY_TIMEOUT = '30s';

export const UNIT_ID_FIELDS = ['resource.attributes.unit.id', 'resource.attributes.unit_id'];

export const CONFIG_HASH_FIELD = 'resource.attributes.streams.config.hash';

export const TIMESTAMP_FIELD = '@timestamp';

export const OUTCOME_FIELD = 'attributes.outcome';

export const DESTINATION_ID_FIELD = 'attributes.streams.destination.id';

export const DESTINATION_ITEMS_FIELD = 'metrics.streams.destination.items';
export const DESTINATION_BYTES_FIELD = 'metrics.streams.destination.bytes';

/** Destination types that emit user-facing metrics (ADR 348, decision 4). */
export const DESTINATION_TYPES_WITH_STATS = ['elasticsearch'];

/** The server sets the unit. The sample mixes `1` and `{item}` for items. */
export const METRIC_UNITS = {
  items: '{item}',
  bytes: 'By',
  duration: 's',
} as const;

/** Cap on distinct outcome values per resource. */
export const MAX_OUTCOME_BUCKETS = 20;
