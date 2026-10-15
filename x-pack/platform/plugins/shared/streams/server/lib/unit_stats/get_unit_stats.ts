/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { StreamsUnit } from '@kbn/streams-schema';
import { DESTINATION_TYPES_WITH_STATS, UNIT_STATS_WINDOW_MS } from './constants';
import { buildDestinationStatsRequest } from './build_destination_stats_request';
import { buildProcessorStatsRequest } from './build_processor_stats_request';
import {
  mapDestinationStatsResponse,
  noDestinationStats,
  type DestinationStatsAggregations,
} from './map_destination_stats_response';
import {
  mapProcessorStatsResponse,
  noProcessorStats,
  type ProcessorStatsAggregations,
} from './map_processor_stats_response';
import {
  buildEarliestStartRequest,
  buildLatestHashRequest,
  readEarliestStartMs,
  readLatestHash,
} from './resolve_config_hash';
import { getSeriesBucketMs } from './series_bucket';

/**
 * Maps a failed search to an error. Each case surfaces differently from the client: a
 * 403 is a ResponseError with security_exception, a missing stream is a 404
 * index_not_found_exception and a timeout is a TimeoutError. Raw Elasticsearch bodies
 * never leave here.
 */
export const errorForSearchFailure = (error: unknown, what: string): StreamsUnit.StatsError => {
  if (error instanceof errors.TimeoutError) {
    return { code: 'unavailable', reason: `The ${what} query timed out.` };
  }
  if (error instanceof errors.ResponseError) {
    if (error.statusCode === 403) {
      return { code: 'forbidden', reason: 'The current user cannot read the stats stream.' };
    }
    if (error.statusCode === 404) {
      return { code: 'unavailable', reason: 'The stats stream does not exist.' };
    }
    if (error.statusCode === 429 || error.statusCode === 503) {
      return { code: 'unavailable', reason: 'Elasticsearch could not serve the stats query.' };
    }
  }
  return { code: 'error', reason: `The ${what} query failed.` };
};

const dedupe = (refs: StreamsUnit.StatsComponentRef[]) => {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export async function getUnitStats({
  unitId,
  unit,
  request,
  esClient,
  logger,
  now = new Date(),
}: {
  unitId: string;
  unit: StreamsUnit.Configuration;
  request: StreamsUnit.StatsRequest;
  esClient: ElasticsearchClient;
  logger: Logger;
  now?: Date;
}): Promise<StreamsUnit.StatsResponse> {
  const range = request.filter?.time_range;
  const window = range ?? {
    start: new Date(now.getTime() - UNIT_STATS_WINDOW_MS).toISOString(),
    end: now.toISOString(),
  };
  const bucketMs = getSeriesBucketMs(Date.parse(window.end) - Date.parse(window.start));

  const destinationConfigs = new Map((unit.destinations ?? []).map((d) => [d.id, d]));
  const processorConfigs = new Map((unit.processors ?? []).map((p) => [p.id, p]));

  // Omitted: every component in config order. An empty array: nothing.
  const refs = dedupe(
    request.components ?? [
      ...(unit.destinations ?? []).map((d) => ({ kind: 'destination' as const, id: d.id })),
      ...(unit.processors ?? []).map((p) => ({ kind: 'processor' as const, id: p.id })),
    ]
  );

  const destinations: Record<string, StreamsUnit.StatsDestinationResult> = {};
  const processors: Record<string, StreamsUnit.StatsProcessorResult> = {};
  const destinationIds: string[] = [];
  const processorIds: string[] = [];

  // Errors that come from the unit config only.
  for (const ref of refs) {
    if (ref.kind === 'destination') {
      const config = destinationConfigs.get(ref.id);
      if (!config) {
        destinations[ref.id] = {
          ...noDestinationStats(bucketMs),
          error: { code: 'not_found', reason: 'No destination with this id in the unit.' },
        };
      } else if (!DESTINATION_TYPES_WITH_STATS.includes(config.type)) {
        destinations[ref.id] = {
          ...noDestinationStats(bucketMs),
          error: { code: 'unsupported', reason: 'Destination type does not emit stats.' },
        };
      } else {
        destinations[ref.id] = noDestinationStats(bucketMs);
        destinationIds.push(ref.id);
      }
    } else if (!processorConfigs.has(ref.id)) {
      processors[ref.id] = {
        ...noProcessorStats(),
        error: { code: 'not_found', reason: 'No processor with this id in the unit.' },
      };
    } else {
      processors[ref.id] = noProcessorStats();
      processorIds.push(ref.id);
    }
  }

  const finish = (
    configHash: string | undefined,
    error?: StreamsUnit.StatsError
  ): StreamsUnit.StatsResponse => ({
    ...(error ? { error } : {}),
    components: { destinations, processors },
    meta: { window, ...(configHash ? { config_hash: configHash } : {}) },
  });

  if (destinationIds.length === 0 && processorIds.length === 0) {
    return finish(request.filter?.config_hash);
  }

  // Shared lookup. The hash (pinned or newest in the window), then the earliest
  // start_timestamp for that hash over all time. A failure here is response-level.
  let configHash = request.filter?.config_hash;
  let earliestStartMs: number | undefined;
  try {
    if (!configHash) {
      configHash = readLatestHash(
        await esClient.search(buildLatestHashRequest({ unitId, window }))
      );
    }
    if (configHash) {
      earliestStartMs = readEarliestStartMs(
        await esClient.search(buildEarliestStartRequest({ unitId, configHash }))
      );
    }
  } catch (error) {
    logger.debug(`Unit stats lookup failed for unit [${unitId}]: ${(error as Error).message}`);
    return finish(undefined, errorForSearchFailure(error, 'stats'));
  }

  // No hash, or no document for it: no data, no error.
  if (!configHash || earliestStartMs === undefined) {
    return finish(configHash);
  }

  // The data covers the window end minus the later of the window start and the first
  // document of this config.
  const seconds =
    (Date.parse(window.end) - Math.max(Date.parse(window.start), earliestStartMs)) / 1000;
  const hash = configHash;

  const destinationSearch = async () => {
    if (destinationIds.length === 0) return;
    try {
      const response = await esClient.search<unknown, DestinationStatsAggregations>(
        buildDestinationStatsRequest({
          unitId,
          window,
          ids: destinationIds,
          configHash: hash,
          bucketMs,
        })
      );
      const mapped = mapDestinationStatsResponse({
        aggregations: response.aggregations,
        seconds,
        bucketMs,
      });
      for (const id of destinationIds) {
        // An id with no bucket is no data: the null result stays.
        destinations[id] = mapped.get(id) ?? destinations[id];
      }
    } catch (error) {
      logger.debug(`Destination stats failed for unit [${unitId}]: ${(error as Error).message}`);
      const failure = errorForSearchFailure(error, 'destination stats');
      for (const id of destinationIds) destinations[id] = { ...destinations[id], error: failure };
    }
  };

  const processorSearch = async () => {
    if (processorIds.length === 0) return;
    try {
      const response = await esClient.search<unknown, ProcessorStatsAggregations>(
        buildProcessorStatsRequest({ unitId, window, ids: processorIds, configHash: hash })
      );
      const mapped = mapProcessorStatsResponse({ aggregations: response.aggregations, seconds });
      for (const id of processorIds) {
        processors[id] = mapped.get(id) ?? processors[id];
      }
    } catch (error) {
      logger.debug(`Processor stats failed for unit [${unitId}]: ${(error as Error).message}`);
      const failure = errorForSearchFailure(error, 'processor stats');
      for (const id of processorIds) processors[id] = { ...processors[id], error: failure };
    }
  };

  // One search per kind, in parallel.
  await Promise.all([destinationSearch(), processorSearch()]);

  return finish(configHash);
}
