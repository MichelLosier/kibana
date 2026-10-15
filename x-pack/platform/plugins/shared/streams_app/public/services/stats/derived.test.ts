/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  formatDuration,
  formatEventsPerSecond,
  getAverageSeconds,
  getEventsPerSecond,
} from './derived';
import { formatDocsTotal, toChartProps } from './destination_docs_cell';
import { createFixtureStatsClient, fixtureStatsResponse } from './fixture_stats_client';
import { entriesForFailure, fromWireResponse, toWireRequest } from './map_stats_response';
import { createStatsClient } from './stats_client';
import { formatStatsText } from './stats_text';
import type { ComponentStats, StatsComponentRef } from './types';
import { IDLE_STATS, statsKey } from './types';

const fixtureEntry = async (
  kind: 'destination' | 'processor',
  id: string
): Promise<ComponentStats> => {
  const client = createFixtureStatsClient();
  const { entries } = await client.fetchStats({
    components: [{ kind, id }],
    signal: new AbortController().signal,
  });
  return entries[statsKey({ kind, id })];
};

describe('derived stats (no division in the UI)', () => {
  it('reads the server rate and the seconds for a processor', async () => {
    const stats = await fixtureEntry('processor', 'uppercase-message');
    expect(formatEventsPerSecond(getEventsPerSecond(stats)!)).toBe('3.7 eps');
    expect(formatDuration(getAverageSeconds(stats)!)).toBe('8ms');
  });

  it('reads the server rate and latency for a destination', async () => {
    const stats = await fixtureEntry('destination', 'es-prod');
    expect(getEventsPerSecond(stats)).toBe(18.4);
    expect(formatDuration(getAverageSeconds(stats)!)).toBe('15ms');
  });

  it('returns undefined for null values so the UI shows a dash, and keeps a real zero', async () => {
    const empty = await fixtureEntry('destination', 'es-dev');
    expect(getEventsPerSecond(empty)).toBeUndefined();
    expect(getAverageSeconds(empty)).toBeUndefined();
    expect(getEventsPerSecond({ ...IDLE_STATS, phase: 'loaded', eventsPerSecond: 0 })).toBe(0);
  });

  it.each([
    [0, '0 eps'],
    [0.0033, '<0.01 eps'],
    [0.333, '0.33 eps'],
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

describe('formatStatsText', () => {
  it.each(['forbidden', 'unavailable', 'unsupported', 'not_found', 'error', 'a_future_code'])(
    'shows a dash for error code %s, never a number',
    (code) => {
      expect(
        formatStatsText({
          ...IDLE_STATS,
          phase: 'loaded',
          eventsPerSecond: 5,
          averageSeconds: 0.1,
          error: { code, reason: 'x' },
        })
      ).toBe('–');
    }
  );

  it('shows a dash for idle and null values, and an ellipsis while loading', () => {
    expect(formatStatsText(IDLE_STATS)).toBe('–');
    expect(formatStatsText({ ...IDLE_STATS, phase: 'loaded' })).toBe('–');
    expect(formatStatsText({ ...IDLE_STATS, phase: 'loading' })).toBe('…');
  });

  it('shows rate only for the table column', async () => {
    const stats = await fixtureEntry('processor', 'uppercase-message');
    expect(formatStatsText(stats, { rate: true })).toBe('3.7 eps');
    expect(formatStatsText(stats)).toBe('3.7 eps · 8ms');
  });
});

describe('docs cell helpers', () => {
  it('formats the total and maps the series to chart props', async () => {
    const stats = await fixtureEntry('destination', 'es-prod');
    expect(formatDocsTotal(stats)).toBe('16,560');
    const chart = toChartProps(stats.series!);
    expect(chart.data).toHaveLength(15);
    expect(chart.data[0]).toEqual({ x: Date.parse('2026-10-14T11:45:00.000Z'), doc_count: 1104 });
    expect(chart.xDomain).toEqual({
      min: Date.parse('2026-10-14T11:45:00.000Z'),
      max: Date.parse('2026-10-14T12:00:00.000Z'),
      minInterval: 60_000,
    });
    // The total is the sum of the points.
    expect(chart.data.reduce((sum, point) => sum + point.doc_count, 0)).toBe(stats.totalEvents);
  });

  it('shows a dash with no data or an error, never zero', async () => {
    expect(formatDocsTotal(await fixtureEntry('destination', 'es-dev'))).toBe('–');
    expect(formatDocsTotal(await fixtureEntry('destination', 'forbidden'))).toBe('–');
    expect(formatDocsTotal({ ...IDLE_STATS, phase: 'loading' })).toBe('…');
  });
});

describe('wire mapper', () => {
  it('sends only kind and id', () => {
    expect(
      toWireRequest([
        { kind: 'processor', id: 'a' },
        { kind: 'destination', id: 'es-prod' },
      ])
    ).toEqual({
      components: [
        { kind: 'processor', id: 'a' },
        { kind: 'destination', id: 'es-prod' },
      ],
    });
  });

  it('keys by kind and id, so one id in two kinds never collides', () => {
    expect(statsKey({ kind: 'destination', id: 'x' })).not.toBe(
      statsKey({ kind: 'processor', id: 'x' })
    );
  });

  it('reads ids with own-property checks (an id like constructor is valid)', () => {
    const requested: StatsComponentRef[] = [{ kind: 'destination', id: 'constructor' }];
    const entries = fromWireResponse(
      fixtureStatsResponse([{ kind: 'destination', id: 'es-dev' }]),
      requested,
      1
    );
    expect(entries[statsKey(requested[0])].error?.code).toBe('error');
  });

  it('copies a response-level error onto every component and keeps own errors', () => {
    const requested: StatsComponentRef[] = [
      { kind: 'destination', id: 'es-prod' },
      { kind: 'processor', id: 'not-in-unit' },
    ];
    const entries = fromWireResponse(
      fixtureStatsResponse(requested, { code: 'unavailable', reason: 'Stream missing.' }),
      requested,
      1
    );
    expect(entries[statsKey(requested[0])].error?.code).toBe('unavailable');
    expect(entries[statsKey(requested[1])].error?.code).toBe('not_found');
  });

  it('marks every component with one error on a whole-call failure', () => {
    const entries = entriesForFailure(
      [{ kind: 'destination', id: 'a' }],
      { code: 'forbidden', reason: 'x' },
      1
    );
    expect(entries[statsKey({ kind: 'destination', id: 'a' })]).toMatchObject({
      phase: 'loaded',
      eventsPerSecond: null,
      error: { code: 'forbidden' },
    });
  });
});

describe('real client', () => {
  const components: StatsComponentRef[] = [{ kind: 'destination', id: 'es-prod' }];
  const signal = new AbortController().signal;

  it('posts to the typed route with the wire body', async () => {
    const fetch = jest.fn().mockResolvedValue(fixtureStatsResponse(components));
    const client = createStatsClient({ streamsRepositoryClient: { fetch } as never });
    const { entries } = await client.fetchStats({ components, signal });
    expect(fetch).toHaveBeenCalledWith('POST /internal/streams/unit/{id}/_stats', {
      signal,
      params: {
        path: { id: 'default' },
        body: { components: [{ kind: 'destination', id: 'es-prod' }] },
      },
    });
    expect(entries[statsKey(components[0])].eventsPerSecond).toBe(18.4);
  });

  it.each([
    [403, 'forbidden'],
    [501, 'unavailable'],
  ])('maps HTTP %p to error code %p for every component', async (statusCode, code) => {
    const error = Object.assign(new Error('x'), {
      name: 'FetchError',
      request: {},
      body: { statusCode },
    });
    const fetch = jest.fn().mockRejectedValue(error);
    const client = createStatsClient({ streamsRepositoryClient: { fetch } as never });
    const { entries } = await client.fetchStats({ components, signal });
    expect(entries[statsKey(components[0])].error?.code).toBe(code);
    expect(entries[statsKey(components[0])].eventsPerSecond).toBeNull();
  });
});
