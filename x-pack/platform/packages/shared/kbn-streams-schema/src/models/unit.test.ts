/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
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

  it('accepts components, a hash and a time range', () => {
    expect(() =>
      streamsUnitStatsRequestSchema.parse({
        filter: {
          config_hash: 'abc',
          time_range: { start: '2026-10-15T12:00:00.000Z', end: '2026-10-15T13:00:00.000Z' },
        },
        components: [
          { kind: 'destination', id: 'es-prod' },
          { kind: 'processor', id: 'uppercase-message' },
        ],
      })
    ).not.toThrow();
  });

  it.each([
    ['unknown top-level field', { time_windw: 1 }],
    ['the old resources field', { resources: [] }],
    ['unknown kind', { components: [{ kind: 'source', id: 'a' }] }],
    ['invalid id', { components: [{ kind: 'destination', id: 'Not_Valid' }] }],
    ['pipeline_id', { components: [{ kind: 'processor', id: 'a', pipeline_id: 'main' }] }],
    ['unknown filter field', { filter: { series: true } }],
    ['empty config hash', { filter: { config_hash: '' } }],
    [
      'time_range with one bound',
      { filter: { time_range: { start: '2026-10-15T12:00:00.000Z' } } },
    ],
    [
      'time_range that is not ISO',
      { filter: { time_range: { start: 'yesterday', end: '2026-10-15T12:00:00.000Z' } } },
    ],
    [
      'time_range that ends before it starts',
      {
        filter: {
          time_range: { start: '2026-10-15T13:00:00.000Z', end: '2026-10-15T12:00:00.000Z' },
        },
      },
    ],
  ])('rejects %s', (_name, body) => {
    expect(() => streamsUnitStatsRequestSchema.parse(body)).toThrow();
  });

  it('has no cap on components', () => {
    expect(() =>
      streamsUnitStatsRequestSchema.parse({
        components: Array.from({ length: 500 }, (_, i) => ({ kind: 'destination', id: `d${i}` })),
      })
    ).not.toThrow();
  });

  it('parses a response and keeps an unknown error code', () => {
    const empty = { events: { incoming: { rate: { value: null, unit: '{item}/s' } } } };
    const parsed = streamsUnitStatsResponseSchema.parse({
      error: { code: 'a_future_code', reason: 'x' },
      components: {
        destinations: {
          'es-prod': {
            latency: { average: { value: 0.1 } },
            events: {
              incoming: {
                total: { value: 3 },
                rate: { value: 0.003, unit: '{item}/s' },
                series: {
                  bucket_ms: 60000,
                  points: [{ start: '2026-10-15T12:00:00.000Z', value: 3 }],
                },
              },
            },
          },
        },
        processors: {
          p: { processing_duration: { average: { value: null } }, ...empty },
        },
      },
      meta: { window: { start: 'a', end: 'b' } },
    });
    expect(parsed.error?.code).toBe('a_future_code');
  });
});
