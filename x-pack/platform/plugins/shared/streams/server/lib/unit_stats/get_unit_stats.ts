/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { STREAMS_UNIT_STATS_MAX_RESOURCES, type StreamsUnit } from '@kbn/streams-schema';
import { DESTINATION_TYPES_WITH_STATS, UNIT_STATS_WINDOW_MS } from './constants';
import { buildDestinationStatsRequest } from './build_destination_stats_request';
import {
  mapDestinationStatsResponse,
  type DestinationStatsAggregations,
} from './map_destination_stats_response';
import { buildConfigHashRequest, readConfigHash } from './resolve_config_hash';

const DEFAULT_SAMPLE_PER_KIND = 25;

const resultFor = (
  ref: StreamsUnit.StatsResourceRef,
  status: string,
  metrics: StreamsUnit.StatsMetric[] = [],
  reason?: string
): StreamsUnit.StatsResourceResult => ({
  kind: ref.kind,
  id: ref.id,
  status,
  metrics,
  ...(reason ? { error: { reason } } : {}),
});

/**
 * Maps a failed search to a per-resource status. Each case surfaces
 * differently from the client: a 403 is a ResponseError with
 * security_exception, a missing stream is a 404 index_not_found_exception and
 * a timeout is a TimeoutError. Raw Elasticsearch bodies never leave here.
 */
export const statusForSearchError = (error: unknown): { status: string; reason?: string } => {
  if (error instanceof errors.TimeoutError) {
    return { status: 'unavailable', reason: 'The stats query timed out.' };
  }
  if (error instanceof errors.ResponseError) {
    if (error.statusCode === 403) {
      return { status: 'forbidden', reason: 'The current user cannot read the stats stream.' };
    }
    if (error.statusCode === 404) {
      return { status: 'unavailable', reason: 'The stats stream does not exist.' };
    }
    if (error.statusCode === 429 || error.statusCode === 503) {
      return { status: 'unavailable', reason: 'Elasticsearch could not serve the stats query.' };
    }
  }
  return { status: 'error', reason: 'The stats query failed.' };
};

const refKey = (ref: StreamsUnit.StatsResourceRef) =>
  `${ref.kind}:${ref.id}:${ref.pipeline_id ?? ''}`;

const dedupe = (refs: StreamsUnit.StatsResourceRef[]) => {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = refKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const defaultSample = (unit: StreamsUnit.Configuration) => {
  const destinations = unit.destinations ?? [];
  const processors = unit.processors ?? [];
  const resources: StreamsUnit.StatsResourceRef[] = [
    ...destinations
      .slice(0, DEFAULT_SAMPLE_PER_KIND)
      .map((d) => ({ kind: 'destination' as const, id: d.id })),
    ...processors
      .slice(0, DEFAULT_SAMPLE_PER_KIND)
      .map((p) => ({ kind: 'processor' as const, id: p.id })),
  ];
  const truncated =
    destinations.length > DEFAULT_SAMPLE_PER_KIND || processors.length > DEFAULT_SAMPLE_PER_KIND;
  return { resources, truncated };
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
  const window = {
    start: new Date(now.getTime() - UNIT_STATS_WINDOW_MS).toISOString(),
    end: now.toISOString(),
  };

  const sampled = request.resources === undefined;
  const sample = sampled ? defaultSample(unit) : undefined;
  const refs = dedupe(sample?.resources ?? request.resources ?? []);

  const destinationsById = new Map((unit.destinations ?? []).map((d) => [d.id, d]));
  const processorIds = new Set((unit.processors ?? []).map((p) => p.id));

  const outcomes = new Map<string, StreamsUnit.StatsResourceResult>();
  const queryableIds: string[] = [];

  for (const ref of refs) {
    if (ref.kind === 'destination') {
      const destination = destinationsById.get(ref.id);
      if (!destination) {
        outcomes.set(refKey(ref), resultFor(ref, 'not_found'));
      } else if (!DESTINATION_TYPES_WITH_STATS.includes(destination.type)) {
        outcomes.set(refKey(ref), resultFor(ref, 'unsupported'));
      } else {
        queryableIds.push(ref.id);
      }
    } else if (!processorIds.has(ref.id)) {
      outcomes.set(refKey(ref), resultFor(ref, 'not_found'));
    } else {
      // Spike: processor stats are a stretch step.
      outcomes.set(
        refKey(ref),
        resultFor(ref, 'unsupported', [], 'Processor stats are not implemented yet.')
      );
    }
  }

  let configHash = request.filter?.config_hash;
  const setAll = (status: string, reason?: string) => {
    for (const ref of refs) {
      if (ref.kind === 'destination' && queryableIds.includes(ref.id)) {
        outcomes.set(refKey(ref), resultFor(ref, status, [], reason));
      }
    }
  };

  if (queryableIds.length > 0) {
    try {
      if (!configHash) {
        const hashResponse = await esClient.search(buildConfigHashRequest({ unitId, window }));
        configHash = readConfigHash(hashResponse);
      }

      if (!configHash) {
        setAll('no_data');
      } else {
        const response = await esClient.search<unknown, DestinationStatsAggregations>(
          buildDestinationStatsRequest({ unitId, window, ids: queryableIds, configHash })
        );
        const rowsById = mapDestinationStatsResponse(response.aggregations);
        for (const ref of refs) {
          if (ref.kind === 'destination' && queryableIds.includes(ref.id)) {
            const rows = rowsById.get(ref.id);
            outcomes.set(refKey(ref), resultFor(ref, rows ? 'ok' : 'no_data', rows ?? []));
          }
        }
      }
    } catch (error) {
      logger.debug(`Unit stats query failed for unit [${unitId}]: ${(error as Error).message}`);
      const { status, reason } = statusForSearchError(error);
      setAll(status, reason);
    }
  }

  return {
    results: refs.map((ref) => outcomes.get(refKey(ref)) ?? resultFor(ref, 'error')),
    meta: {
      window,
      ...(configHash ? { config_hash: configHash } : {}),
      sampled,
      truncated: sample?.truncated ?? false,
      limits: { max_resources: STREAMS_UNIT_STATS_MAX_RESOURCES },
    },
  };
}
