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
import { buildProcessorStatsRequest } from './build_processor_stats_request';
import { UNIT_STATS_STREAM } from './constants';
import { getUnitStats } from './get_unit_stats';
import { mapDestinationStatsResponse } from './map_destination_stats_response';
import { averageSecondsPerEvent, mapProcessorStatsResponse } from './map_processor_stats_response';
import { getSeriesBucketMs } from './series_bucket';

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
const MINUTE = 60_000;

const hashResponse = {
  hits: { hits: [{ fields: { 'resource.attributes.streams.config.hash': ['h1'] } }] },
};
// The config started 5 minutes before the window ends, so rates divide by 300 s.
const earliestResponse = (ms: number | null) => ({ aggregations: { earliest: { value: ms } } });
const fiveMinutesAgo = now.getTime() - 5 * MINUTE;

const destinationAggregations = {
  by_id: {
    buckets: [
      {
        key: 'es-prod',
        items: {
          doc_count: 6,
          sum: { value: 30 },
          series: {
            buckets: [
              { key: Date.parse('2026-10-14T11:56:00.000Z'), doc_count: 3, sum: { value: 20 } },
              { key: Date.parse('2026-10-14T11:57:00.000Z'), doc_count: 3, sum: { value: 10 } },
            ],
          },
        },
        duration: { doc_count: 6, average: { value: 0.107 } },
      },
      {
        // Documents exist for this id but none carry items: no data.
        key: 'es-dev',
        items: { doc_count: 0, sum: { value: 0 }, series: { buckets: [] } },
        duration: { doc_count: 0, average: { value: null } },
      },
    ],
  },
};

const processorAggregations = {
  by_id: {
    buckets: [
      {
        key: 'uppercase-message',
        items_in: { doc_count: 4, sum: { value: 35 } },
        duration: { doc_count: 4, sum: { value: 0.001895 } },
      },
    ],
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

/** Answers each search by its shape: hash, earliest start, destination or processor. */
const makeSearch = (
  overrides: { destination?: () => unknown; processor?: () => unknown; hash?: () => unknown } = {}
) =>
  jest.fn(async (body: { size?: number; aggs?: Record<string, unknown>; sort?: unknown }) => {
    if (body.sort) return (overrides.hash ?? (() => hashResponse))();
    if (body.aggs && 'earliest' in body.aggs) return earliestResponse(fiveMinutesAgo);
    const by = (body.aggs?.by_id as { terms: { field: string } }).terms.field;
    return by.includes('destination')
      ? (overrides.destination ?? (() => ({ aggregations: destinationAggregations })))()
      : (overrides.processor ?? (() => ({ aggregations: processorAggregations })))();
  });

const responseError = (statusCode: number) =>
  new errors.ResponseError({ statusCode, body: {}, headers: {}, warnings: [], meta: {} as never });

describe('series bucket', () => {
  it.each([
    [15 * MINUTE, MINUTE],
    [5 * MINUTE, 12_000],
    [MINUTE, 10_000],
    [3_600_000, MINUTE],
    [86_400_000, 15 * MINUTE],
  ])('range %p ms gives a %p ms bucket', (range, bucket) => {
    expect(getSeriesBucketMs(range)).toBe(bucket);
  });
});

describe('query builders', () => {
  it('destination: exact stream, size 0, unit, window, hash and ids, date_histogram on the bucket', () => {
    const body = buildDestinationStatsRequest({
      unitId: 'default',
      window: { start: 'a', end: 'b' },
      ids: ['es-prod'],
      configHash: 'h1',
      bucketMs: 60000,
    });
    expect(body.index).toBe(UNIT_STATS_STREAM);
    expect(body.size).toBe(0);
    const text = JSON.stringify(body);
    expect(text).toContain('resource.attributes.unit.id');
    expect(text).toContain('resource.attributes.unit_id');
    expect(text).toContain('"h1"');
    expect(text).toContain('"fixed_interval":"60000ms"');
    expect(text).not.toContain('outcome');
  });

  it('processor: direction in, no pipeline filter, a sum for the duration', () => {
    const text = JSON.stringify(
      buildProcessorStatsRequest({
        unitId: 'default',
        window: { start: 'a', end: 'b' },
        ids: ['uppercase-message'],
        configHash: 'h1',
      })
    );
    expect(text).toContain('"attributes.direction":"in"');
    expect(text).not.toContain('pipeline');
    expect(text).not.toContain('outcome');
    expect(text).toContain('"sum":{"field":"metrics.streams.step.duration"}');
    expect(text).not.toContain('"avg"');
  });
});

describe('mappers', () => {
  it('destination: total is the sum of the points and the rate uses the covered seconds', () => {
    const mapped = mapDestinationStatsResponse({
      aggregations: destinationAggregations,
      seconds: 300,
      bucketMs: MINUTE,
    });
    const prod = mapped.get('es-prod')!;
    expect(prod.events.incoming.series.points).toEqual([
      { start: '2026-10-14T11:56:00.000Z', value: 20 },
      { start: '2026-10-14T11:57:00.000Z', value: 10 },
    ]);
    expect(prod.events.incoming.total.value).toBe(30);
    expect(prod.events.incoming.rate).toEqual({ value: 0.1, unit: '{item}/s' });
    expect(prod.latency.average.value).toBe(0.107);
    const dev = mapped.get('es-dev')!;
    expect(dev.events.incoming.total.value).toBeNull();
    expect(dev.events.incoming.series).toEqual({ bucket_ms: MINUTE, points: [] });
    expect(dev.latency.average.value).toBeNull();
  });

  it('processor: seconds per event, not per batch', () => {
    // The live numbers: 0.001895 s over 35 items is 54.1 microseconds per event.
    expect(averageSecondsPerEvent(0.001895, 35)).toBeCloseTo(0.0000541, 7);
    expect(averageSecondsPerEvent(0.5, 0)).toBeNull();
    expect(averageSecondsPerEvent(undefined, 5)).toBeNull();
    const result = mapProcessorStatsResponse({
      aggregations: processorAggregations,
      seconds: 350,
    }).get('uppercase-message')!;
    expect(result.events.incoming.rate.value).toBeCloseTo(0.1);
    expect(result.processing_duration.average.value).toBeCloseTo(0.0000541, 7);
  });
});

describe('getUnitStats', () => {
  it('returns both maps, keyed by id, with data, no data, not_found and unsupported', async () => {
    const search = makeSearch();
    const response = await run({ search } as never, {
      components: [
        { kind: 'destination', id: 'es-dev' },
        { kind: 'destination', id: 'es-prod' },
        { kind: 'destination', id: 'es-prod' },
        { kind: 'destination', id: 'nope' },
        { kind: 'destination', id: 'dbg' },
        { kind: 'processor', id: 'uppercase-message' },
        { kind: 'processor', id: 'gone' },
      ],
    });
    expect(response.error).toBeUndefined();
    expect(Object.keys(response.components.destinations)).toEqual([
      'es-dev',
      'es-prod',
      'nope',
      'dbg',
    ]);
    const d = response.components.destinations;
    expect(d['es-prod'].events.incoming.total.value).toBe(30);
    // The covered time is 300 s (the config started 5 minutes before the window end).
    expect(d['es-prod'].events.incoming.rate.value).toBeCloseTo(0.1);
    expect(d['es-dev'].error).toBeUndefined();
    expect(d['es-dev'].events.incoming.rate.value).toBeNull();
    expect(d.nope.error?.code).toBe('not_found');
    expect(d.dbg.error?.code).toBe('unsupported');
    expect(response.components.processors.gone.error?.code).toBe('not_found');
    expect(response.components.processors['uppercase-message'].error).toBeUndefined();
    expect(response.meta).toEqual({
      window: { start: '2026-10-14T11:45:00.000Z', end: '2026-10-14T12:00:00.000Z' },
      config_hash: 'h1',
    });
    // hash, earliest start, one destination search, one processor search.
    expect(search).toHaveBeenCalledTimes(4);
  });

  it('uses the time_range, a pinned hash and skips the hash search', async () => {
    const search = makeSearch();
    const response = await run({ search } as never, {
      filter: {
        config_hash: 'mine',
        time_range: { start: '2026-10-14T10:00:00.000Z', end: '2026-10-14T11:00:00.000Z' },
      },
      components: [{ kind: 'destination', id: 'es-prod' }],
    });
    // earliest start and one destination search. No hash search.
    expect(search).toHaveBeenCalledTimes(2);
    expect(response.meta).toEqual({
      window: { start: '2026-10-14T10:00:00.000Z', end: '2026-10-14T11:00:00.000Z' },
      config_hash: 'mine',
    });
    expect(response.components.destinations['es-prod'].events.incoming.series.bucket_ms).toBe(
      MINUTE
    );
  });

  it('returns null values and no error when no hash is found or the hash matches nothing', async () => {
    const none = await run(
      { search: makeSearch({ hash: () => ({ hits: { hits: [] } }) }) } as never,
      { components: [{ kind: 'destination', id: 'es-prod' }] }
    );
    expect(none.error).toBeUndefined();
    expect(none.components.destinations['es-prod'].events.incoming.rate.value).toBeNull();

    const search = jest.fn().mockResolvedValue(earliestResponse(null));
    const pinned = await run({ search } as never, {
      filter: { config_hash: 'nothing' },
      components: [{ kind: 'destination', id: 'es-prod' }],
    });
    expect(pinned.error).toBeUndefined();
    expect(pinned.components.destinations['es-prod'].events.incoming.series.points).toEqual([]);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('returns every component for an omitted list and nothing for an empty list', async () => {
    const all = await run({ search: makeSearch() } as never, {});
    expect(Object.keys(all.components.destinations)).toEqual(['es-prod', 'es-dev', 'dbg']);
    expect(Object.keys(all.components.processors)).toEqual(['uppercase-message']);
    const search = makeSearch();
    const empty = await run({ search } as never, { components: [] });
    expect(empty.components).toEqual({ destinations: {}, processors: {} });
    expect(search).not.toHaveBeenCalled();
  });

  it.each([
    [responseError(403), 'forbidden'],
    [responseError(404), 'unavailable'],
    [new errors.TimeoutError('timeout', {} as never), 'unavailable'],
    [new Error('boom'), 'error'],
  ])(
    'puts a hash lookup failure on the response, with null entries and no entry errors',
    async (error, code) => {
      const response = await run({ search: jest.fn().mockRejectedValue(error) } as never, {
        components: [
          { kind: 'destination', id: 'es-prod' },
          { kind: 'processor', id: 'uppercase-message' },
        ],
      });
      expect(response.error?.code).toBe(code);
      expect(response.error?.reason).not.toMatch(/\{|stack/);
      expect(response.components.destinations['es-prod'].error).toBeUndefined();
      expect(response.components.destinations['es-prod'].events.incoming.total.value).toBeNull();
      expect(response.components.processors['uppercase-message'].error).toBeUndefined();
    }
  );

  it('copies one kind search failure onto every component of that kind only', async () => {
    const response = await run(
      {
        search: makeSearch({
          processor: () => {
            throw responseError(403);
          },
        }),
      } as never,
      {
        components: [
          { kind: 'destination', id: 'es-prod' },
          { kind: 'processor', id: 'uppercase-message' },
        ],
      }
    );
    expect(response.error).toBeUndefined();
    expect(response.components.processors['uppercase-message'].error?.code).toBe('forbidden');
    expect(response.components.destinations['es-prod'].error).toBeUndefined();
    expect(response.components.destinations['es-prod'].events.incoming.total.value).toBe(30);
  });
});
