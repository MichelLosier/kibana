/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export { createStatsClient } from './stats_client';
export { createFixtureStatsClient } from './fixture_stats_client';
export { StatsManagerProvider, useRegisterStats, useStatsFor } from './stats_context';
export {
  formatDuration,
  formatEventsPerSecond,
  getAverageSeconds,
  getEventsPerSecond,
} from './derived';
export type { ComponentStats, StatsClient, StatsComponentRef } from './types';
export { statsKey } from './types';
export { formatStatsText, StatsText } from './stats_text';
export { countRender } from './render_counter';
