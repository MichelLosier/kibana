/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StreamsUnit } from '@kbn/streams-schema';
import type { ResourceStats, StatsResourceRef, StatsResourceType } from './types';
import { statsKey } from './types';

/** The only file that maps between UI domain types and the wire shape. */

const WIRE_KIND: Record<StatsResourceType, StreamsUnit.StatsResourceRef['kind']> = {
  destination: 'destination',
  step: 'processor',
};

const UI_TYPE: Record<string, StatsResourceType> = {
  destination: 'destination',
  processor: 'step',
};

export const toWireRequest = (resources: StatsResourceRef[]): StreamsUnit.StatsRequest => ({
  resources: resources.map((ref) => ({
    kind: WIRE_KIND[ref.type],
    id: ref.id,
    ...(ref.pipelineId ? { pipeline_id: ref.pipelineId } : {}),
  })),
});

const windowSeconds = (meta: StreamsUnit.StatsMeta): number | undefined => {
  const seconds = (Date.parse(meta.window.end) - Date.parse(meta.window.start)) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
};

const mapStatus = (wire: string): Pick<ResourceStats, 'status' | 'reason'> => {
  switch (wire) {
    case 'ok':
      return { status: 'ready' };
    case 'no_data':
    case 'forbidden':
    case 'unavailable':
      return { status: wire };
    default:
      // error, not_found, unsupported and any future value.
      return { status: 'unavailable', reason: wire };
  }
};

export const fromWireResponse = (
  response: StreamsUnit.StatsResponse,
  now: number
): Record<string, ResourceStats> => {
  const seconds = windowSeconds(response.meta);
  const entries: Record<string, ResourceStats> = {};

  for (const result of response.results) {
    const type = UI_TYPE[result.kind];
    if (!type) {
      continue; // Unknown kind. Ignore the result.
    }
    const { status, reason } = mapStatus(result.status);
    entries[statsKey({ type, id: result.id, pipelineId: result.pipeline_id })] = {
      status,
      metrics: result.metrics,
      windowSeconds: seconds,
      lastUpdated: now,
      ...(reason || result.error?.reason
        ? { reason: [reason, result.error?.reason].filter(Boolean).join(': ') }
        : {}),
    };
  }

  return entries;
};

/** Marks every requested resource with one state. Used when the whole call fails. */
export const entriesForFailure = (
  resources: StatsResourceRef[],
  status: 'forbidden' | 'unavailable',
  reason: string,
  now: number
): Record<string, ResourceStats> =>
  Object.fromEntries(
    resources.map((ref) => [statsKey(ref), { status, metrics: [], lastUpdated: now, reason }])
  );
