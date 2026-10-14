/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient } from '@kbn/core/server';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import type { StreamsUnit } from '@kbn/streams-schema';
import { buildDestinationStatsRequest } from './build_destination_stats_request';
import { UNIT_STATS_STREAM } from './constants';
import { getUnitStats } from './get_unit_stats';
import { mapDestinationStatsResponse } from './map_destination_stats_response';

const unit: StreamsUnit.Configuration = {
  sources: [],
  destinations: [
    { id: 'es-prod', type: 'elasticsearch', supported_telemetry: ['logs'] },
    { id: 'es-dev', type: 'elasticsearch', supported_telemetry: ['logs'] },
    { id: 'dbg', type: 'debug', supported_telemetry: ['logs'] },
  ],
  processors: [{ id: 'uppercase-message', type: 'add_fields', supported_telemetry: ['logs'] }],
  pipelines: [],
};

const now = new Date('2026-10-14T12:00:00.000Z');

const hashResponse = {
  hits: { hits: [{ fields: { 'resource.attributes.streams.config.hash': ['h1'] } }] },
};

const statsResponse = {
  aggregations: {
    by_id: {
      buckets: [
        {
          key: 'es-prod',
          doc_count: 10,
          items: {
            doc_count: 4,
            by_outcome: {
              buckets: [
                { key: 'success', doc_count: 3, total: { value: 100 } },
                { key: 'failure', doc_count: 1, total: { value: 2 } },
              ],
            },
          },
          bytes: { doc_count: 3, total: { value: 5000 } },
        },
        {
          // Documents exist for this id, but none carry a counter we read.
          key: 'es-dev',
          doc_count: 2,
          items: { doc_count: 0, by_outcome: { buckets: [] } },
          bytes: { doc_count: 0, total: { value: 0 } },
        },
      ],
    },
  },
};

const run = (esClient: Partial<ElasticsearchClient>, request: StreamsUnit.StatsRequest) =>
  getUnitStats({
    unitId: 'default',
    unit,
    request,
    esClient: esClient as ElasticsearchClient,
    logger: loggingSystemMock.createLogger(),
    now,
  });

const responseError = (statusCode: number) =>
  new errors.ResponseError({
    statusCode,
    body: {},
    headers: {},
    warnings: [],
    meta: {} as never,
  });

describe('buildDestinationStatsRequest', () => {
  it('queries the exact stream with size 0 and filters by unit, window, hash and ids', () => {
    const body = buildDestinationStatsRequest({
      unitId: 'default',
      window: { start: 'a', end: 'b' },
      ids: ['es-prod'],
      configHash: 'h1',
    });
    expect(body.index).toBe(UNIT_STATS_STREAM);
    expect(body.size).toBe(0);
    expect(JSON.stringify(body.query)).toContain('resource.attributes.unit.id');
    expect(JSON.stringify(body.query)).toContain('resource.attributes.unit_id');
    expect(JSON.stringify(body.query)).toContain('"h1"');
    expect(JSON.stringify(body.query)).toContain('es-prod');
  });
});

describe('mapDestinationStatsResponse', () => {
  it('emits no row for an empty metric and no entry for an id without rows', () => {
    const rows = mapDestinationStatsResponse(statsResponse.aggregations);
    expect(rows.get('es-prod')).toEqual([
      {
        name: 'items',
        aggregation: 'sum',
        value: 100,
        unit: '{item}',
        dimensions: { outcome: 'success' },
      },
      {
        name: 'items',
        aggregation: 'sum',
        value: 2,
        unit: '{item}',
        dimensions: { outcome: 'failure' },
      },
      { name: 'bytes', aggregation: 'sum', value: 5000, unit: 'By' },
    ]);
    expect(rows.has('es-dev')).toBe(false);
  });
});

describe('getUnitStats', () => {
  it('returns ok, no_data, not_found and unsupported per resource, in request order', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce(hashResponse)
      .mockResolvedValueOnce(statsResponse);
    const response = await run(
      { search },
      {
        resources: [
          { kind: 'destination', id: 'es-dev' },
          { kind: 'destination', id: 'es-prod' },
          { kind: 'destination', id: 'es-prod' },
          { kind: 'destination', id: 'nope' },
          { kind: 'destination', id: 'dbg' },
        ],
      }
    );
    expect(response.results.map((r) => [r.id, r.status])).toEqual([
      ['es-dev', 'no_data'],
      ['es-prod', 'ok'],
      ['nope', 'not_found'],
      ['dbg', 'unsupported'],
    ]);
    expect(response.meta).toMatchObject({
      config_hash: 'h1',
      sampled: false,
      truncated: false,
      window: { start: '2026-10-14T11:45:00.000Z', end: '2026-10-14T12:00:00.000Z' },
    });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('skips the hash search when the request has a hash and echoes it', async () => {
    const search = jest.fn().mockResolvedValue(statsResponse);
    const response = await run(
      { search },
      { filter: { config_hash: 'mine' }, resources: [{ kind: 'destination', id: 'es-prod' }] }
    );
    expect(search).toHaveBeenCalledTimes(1);
    expect(response.meta.config_hash).toBe('mine');
  });

  it('returns no_data and runs one search when no document exists', async () => {
    const search = jest.fn().mockResolvedValue({ hits: { hits: [] } });
    const response = await run({ search }, { resources: [{ kind: 'destination', id: 'es-prod' }] });
    expect(response.results[0].status).toBe('no_data');
    expect(response.meta.config_hash).toBeUndefined();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('uses the default sample when resources are omitted and an empty list means nothing', async () => {
    const search = jest.fn().mockResolvedValue({ hits: { hits: [] } });
    const sample = await run({ search }, {});
    expect(sample.meta.sampled).toBe(true);
    expect(sample.results.map((r) => r.id)).toEqual([
      'es-prod',
      'es-dev',
      'dbg',
      'uppercase-message',
    ]);
    const empty = await run({ search }, { resources: [] });
    expect(empty.results).toEqual([]);
    expect(empty.meta.sampled).toBe(false);
  });

  it.each([
    [responseError(403), 'forbidden'],
    [responseError(404), 'unavailable'],
    [new errors.TimeoutError('timeout', {} as never), 'unavailable'],
    [new Error('boom'), 'error'],
  ])('maps a search failure to a status', async (error, status) => {
    const search = jest.fn().mockRejectedValue(error);
    const response = await run({ search }, { resources: [{ kind: 'destination', id: 'es-prod' }] });
    expect(response.results[0].status).toBe(status);
  });
});
