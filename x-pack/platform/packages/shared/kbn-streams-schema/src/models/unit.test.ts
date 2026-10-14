/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  STREAMS_UNIT_STATS_MAX_RESOURCES,
  collectUnitComponentIds,
  findDuplicateUnitComponentIds,
  streamsUnitSchema,
  streamsUnitSecretsSchema,
  streamsUnitStatsRequestSchema,
  streamsUnitStatsResponseSchema,
  streamsUnitUpsertRequestSchema,
  type StreamsUnit,
} from './unit';

const validUnit: StreamsUnit.Configuration = {
  sources: [
    {
      id: 'otlp-input',
      type: 'nop',
      supported_telemetry: ['logs'],
    },
  ],
  processors: [
    {
      id: 'add-env',
      type: 'add_fields',
      supported_telemetry: ['logs'],
    },
  ],
  destinations: [
    {
      id: 'es-prod',
      type: 'debug',
      supported_telemetry: ['logs'],
    },
  ],
  pipelines: [
    {
      id: 'main',
      supported_telemetry: ['logs'],
      config: [
        { name: 'sources', value: ['otlp-input'] },
        { name: 'processors', value: ['add-env'] },
        { name: 'destinations', value: ['es-prod'] },
      ],
    },
  ],
};

describe('streams unit schema', () => {
  it('defaults omitted sources, destinations, and pipelines to empty arrays', () => {
    expect(streamsUnitSchema.parse({ sources: validUnit.sources })).toEqual({
      sources: validUnit.sources,
      destinations: [],
      pipelines: [],
    });
  });

  it('rejects invalid component identifiers', () => {
    expect(() =>
      streamsUnitSchema.parse({
        ...validUnit,
        sources: [
          {
            id: '_default_',
            type: 'nop',
            supported_telemetry: ['logs'],
          },
        ],
      })
    ).toThrow();
  });

  it('collects ids across component kinds', () => {
    expect(collectUnitComponentIds(validUnit).sort()).toEqual(
      ['add-env', 'es-prod', 'main', 'otlp-input'].sort()
    );
  });

  it('accepts an omitted secrets bag on upsert and rejects oversized maps', () => {
    expect(
      streamsUnitUpsertRequestSchema.parse({
        unit: { sources: validUnit.sources },
        ui_metadata: {},
      }).secrets
    ).toBeUndefined();
    expect(streamsUnitSecretsSchema.parse({ es_api_key: 's3cret' })).toEqual({
      es_api_key: 's3cret',
    });
    expect(() =>
      streamsUnitSecretsSchema.parse(
        Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${i}`, 'v']))
      )
    ).toThrow();
  });

  it('finds duplicate ids across component kinds', () => {
    expect(
      findDuplicateUnitComponentIds({
        ...validUnit,
        processors: [
          {
            id: 'otlp-input',
            type: 'add_fields',
            supported_telemetry: ['logs'],
          },
        ],
      })
    ).toEqual(['otlp-input']);
  });
});

describe('streams unit stats schemas', () => {
  it('accepts an empty request', () => {
    expect(streamsUnitStatsRequestSchema.parse({})).toEqual({});
  });

  it('accepts a request with filter and resources', () => {
    expect(() =>
      streamsUnitStatsRequestSchema.parse({
        filter: { config_hash: 'abc' },
        resources: [
          { kind: 'destination', id: 'es-prod' },
          { kind: 'processor', id: 'uppercase-message', pipeline_id: 'main' },
        ],
      })
    ).not.toThrow();
  });

  it.each([
    ['unknown top-level field', { time_windw: 1 }],
    ['unknown resource kind', { resources: [{ kind: 'source', id: 'a' }] }],
    ['invalid resource id', { resources: [{ kind: 'destination', id: 'Not_Valid' }] }],
    ['unknown resource field', { resources: [{ kind: 'destination', id: 'a', extra: 1 }] }],
    ['unknown filter field', { filter: { time_range: {} } }],
    ['empty config hash', { filter: { config_hash: '' } }],
    [
      'too many resources',
      {
        resources: Array.from({ length: STREAMS_UNIT_STATS_MAX_RESOURCES + 1 }, (_, i) => ({
          kind: 'destination',
          id: `d${i}`,
        })),
      },
    ],
  ])('rejects %s', (_name, body) => {
    expect(() => streamsUnitStatsRequestSchema.parse(body)).toThrow();
  });

  it('parses the response example and keeps unknown statuses', () => {
    const parsed = streamsUnitStatsResponseSchema.parse({
      results: [
        {
          kind: 'destination',
          id: 'es-prod',
          status: 'ok',
          metrics: [
            {
              name: 'items',
              aggregation: 'sum',
              value: 12,
              unit: '{item}',
              dimensions: { outcome: 'success' },
            },
          ],
        },
        { kind: 'destination', id: 'es-dev', status: 'a_future_status', metrics: [] },
      ],
      meta: { window: { start: '2026-10-13T12:32:00.000Z', end: '2026-10-13T12:47:00.000Z' } },
    });
    expect(parsed.results[1].status).toBe('a_future_status');
  });
});
