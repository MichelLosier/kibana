/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  formatDuration,
  formatEventsPerSecond,
  getAverageDurationSeconds,
  getEventsPerSecond,
} from './derived';
import { createFixtureStatsClient } from './fixture_stats_client';
import { fromWireResponse, toWireRequest } from './map_stats_response';
import { createStatsClient } from './stats_client';
import type { ResourceStats } from './types';
import { statsKey } from './types';

const fixtureEntry = async (type: 'destination' | 'step', id: string): Promise<ResourceStats> => {
  const client = createFixtureStatsClient();
  const { entries } = await client.fetchStats({
    resources: [{ type, id }],
    signal: new AbortController().signal,
  });
  return entries[statsKey({ type, id })];
};

describe('derived stats', () => {
  it('computes eps and average duration for a step (out direction)', async () => {
    const stats = await fixtureEntry('step', 'uppercase-message');
    expect(formatEventsPerSecond(getEventsPerSecond(stats, 'step')!)).toBe('3.7 eps');
    expect(formatDuration(getAverageDurationSeconds(stats)!)).toBe('8ms');
  });

  it('counts only delivered items for a destination', async () => {
    const stats = await fixtureEntry('destination', 'es-prod');
    // 16,560 success items over 900 s. The 12 failures are not counted.
    expect(getEventsPerSecond(stats, 'destination')).toBeCloseTo(18.4, 1);
    expect(formatDuration(getAverageDurationSeconds(stats)!)).toBe('15ms');
  });

  it('returns undefined for no_data so the UI shows a dash, and keeps a real zero', async () => {
    const empty = await fixtureEntry('destination', 'es-dev');
    expect(getEventsPerSecond(empty, 'destination')).toBeUndefined();
    const zero: ResourceStats = {
      status: 'ready',
      windowSeconds: 900,
      metrics: [{ name: 'items', aggregation: 'sum', value: 0, unit: '{item}' }],
    };
    expect(getEventsPerSecond(zero, 'destination')).toBe(0);
  });

  it.each([
    [0, '0 eps'],
    [3.74, '3.7 eps'],
    [42.4, '42 eps'],
    [3700, '3.7k eps'],
    [18_400, '18.4k eps'],
    [2_500_000, '2.5M eps'],
  ])('formats %p as %p', (eps, text) => {
    expect(formatEventsPerSecond(eps)).toBe(text);
  });

  it.each([
    [0.000077, '77µs'],
    [0.008, '8ms'],
    [0.1071, '107ms'],
    [1.24, '1.2s'],
  ])('formats %p seconds as %p', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe('wire mapper', () => {
  it('renames step to processor and sends pipeline_id only when set', () => {
    expect(
      toWireRequest([
        { type: 'step', id: 'a' },
        { type: 'step', id: 'a', pipelineId: 'main-route-0' },
        { type: 'destination', id: 'es-prod' },
      ])
    ).toEqual({
      resources: [
        { kind: 'processor', id: 'a' },
        { kind: 'processor', id: 'a', pipeline_id: 'main-route-0' },
        { kind: 'destination', id: 'es-prod' },
      ],
    });
  });

  it('keys placements apart and ignores unknown kinds', () => {
    const entries = fromWireResponse(
      {
        meta: { window: { start: '2026-10-14T00:00:00Z', end: '2026-10-14T00:15:00Z' } },
        results: [
          { kind: 'processor', id: 'a', status: 'ok', metrics: [] },
          { kind: 'processor', id: 'a', pipeline_id: 'p', status: 'no_data', metrics: [] },
          { kind: 'source', id: 'x', status: 'ok', metrics: [] },
        ],
      },
      1
    );
    expect(Object.keys(entries)).toHaveLength(2);
    expect(entries[statsKey({ type: 'step', id: 'a' })].status).toBe('ready');
    expect(entries[statsKey({ type: 'step', id: 'a', pipelineId: 'p' })].status).toBe('no_data');
  });
});

describe('real client', () => {
  const resources = [{ type: 'destination' as const, id: 'es-prod' }];
  const signal = new AbortController().signal;

  it('posts to the typed route with the wire body', async () => {
    const fetch = jest.fn().mockResolvedValue({
      meta: { window: { start: '2026-10-14T00:00:00Z', end: '2026-10-14T00:15:00Z' } },
      results: [{ kind: 'destination', id: 'es-prod', status: 'ok', metrics: [] }],
    });
    const client = createStatsClient({ streamsRepositoryClient: { fetch } as never });
    const { entries } = await client.fetchStats({ resources, signal });
    expect(fetch).toHaveBeenCalledWith('POST /internal/streams/unit/{id}/_stats', {
      signal,
      params: {
        path: { id: 'default' },
        body: { resources: [{ kind: 'destination', id: 'es-prod' }] },
      },
    });
    expect(entries[statsKey(resources[0])].status).toBe('ready');
  });

  it.each([
    [403, 'forbidden'],
    [501, 'unavailable'],
  ])('maps HTTP %p to %p for every resource', async (statusCode, status) => {
    const error = Object.assign(new Error('x'), {
      name: 'FetchError',
      request: {},
      body: { statusCode },
    });
    const fetch = jest.fn().mockRejectedValue(error);
    const client = createStatsClient({ streamsRepositoryClient: { fetch } as never });
    const { entries } = await client.fetchStats({ resources, signal });
    expect(entries[statsKey(resources[0])].status).toBe(status);
  });
});
