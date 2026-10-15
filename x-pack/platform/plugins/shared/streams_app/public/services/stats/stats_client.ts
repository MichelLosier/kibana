/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isHttpFetchError } from '@kbn/server-route-repository-client';
import { STREAMS_DEFAULT_UNIT_ID } from '@kbn/streams-plugin/common';
import type { StreamsRepositoryClient } from '@kbn/streams-plugin/public/api';
import { entriesForFailure, fromWireResponse, toWireRequest } from './map_stats_response';
import type { StatsClient } from './types';

const statusCodeOf = (error: unknown): number | undefined =>
  isHttpFetchError(error) ? error.body?.statusCode ?? error.response?.status : undefined;

/**
 * The real client. A 403 marks every resource `forbidden`. Any other HTTP error,
 * including 404 and 501, marks them `unavailable`. An abort rethrows so the
 * manager drops the result.
 */
export const createStatsClient = ({
  streamsRepositoryClient,
  unitId = STREAMS_DEFAULT_UNIT_ID,
}: {
  streamsRepositoryClient: StreamsRepositoryClient;
  unitId?: string;
}): StatsClient => ({
  fetchStats: async ({ components, signal }) => {
    try {
      const response = await streamsRepositoryClient.fetch(
        'POST /internal/streams/unit/{id}/_stats',
        {
          signal,
          params: { path: { id: unitId }, body: toWireRequest(components) },
        }
      );
      return { entries: fromWireResponse(response, components, Date.now()) };
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      const code = statusCodeOf(error);
      if (code === 403) {
        return {
          entries: entriesForFailure(
            components,
            { code: 'forbidden', reason: 'HTTP 403' },
            Date.now()
          ),
        };
      }
      if (code !== undefined) {
        return {
          entries: entriesForFailure(
            components,
            { code: 'unavailable', reason: `HTTP ${code}` },
            Date.now()
          ),
        };
      }
      throw error;
    }
  },
});
