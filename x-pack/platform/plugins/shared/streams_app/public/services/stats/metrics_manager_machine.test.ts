/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createActor } from 'xstate';
import { createFixtureStatsClient } from './fixture_stats_client';
import { metricsManagerMachine } from './metrics_manager_machine';
import type { StatsClient, StatsComponentRef } from './types';
import { IDLE_STATS, statsKey } from './types';

const prod: StatsComponentRef = { kind: 'destination', id: 'es-prod' };
const dev: StatsComponentRef = { kind: 'destination', id: 'es-dev' };
const step: StatsComponentRef = { kind: 'processor', id: 'uppercase-message' };

const start = (client: StatsClient) => {
  const actor = createActor(metricsManagerMachine, {
    input: { client, tuning: { poolWindowMs: 100, graceMs: 1000 } },
  }).start();
  return actor;
};

const flush = async (ms: number) => {
  await jest.advanceTimersByTimeAsync(ms);
};

describe('metrics manager machine', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('pools registrations in one window into one request', async () => {
    const client = createFixtureStatsClient({ delayMs: 50 });
    const actor = start(client);
    actor.send({ type: 'resource.register', ref: prod });
    actor.send({ type: 'resource.register', ref: dev });
    actor.send({ type: 'resource.register', ref: step });
    expect(actor.getSnapshot().value).toBe('pooling');
    await flush(100);
    expect(actor.getSnapshot().context.entries[statsKey(prod)].phase).toBe('loading');
    await flush(60);
    expect(client.calls).toEqual([{ count: 3 }]);
    expect(actor.getSnapshot().value).toBe('idle');
    const { entries } = actor.getSnapshot().context;
    expect(entries[statsKey(prod)]).toMatchObject({
      phase: 'loaded',
      eventsPerSecond: 18.4,
      totalEvents: 16560,
    });
    expect(entries[statsKey(dev)]).toMatchObject({
      phase: 'loaded',
      eventsPerSecond: null,
      totalEvents: null,
    });
    expect(entries[statsKey(dev)].error).toBeUndefined();
    expect(entries[statsKey(step)]).toMatchObject({ eventsPerSecond: 3.7, averageSeconds: 0.008 });
  });

  it('does not refetch a registered resource that has data, and counts registrations', async () => {
    const client = createFixtureStatsClient();
    const actor = start(client);
    actor.send({ type: 'resource.register', ref: prod });
    await flush(101);
    actor.send({ type: 'resource.register', ref: prod });
    expect(actor.getSnapshot().context.registrations[statsKey(prod)].count).toBe(2);
    await flush(200);
    expect(client.calls).toHaveLength(1);
  });

  it('keeps the entry object when nothing changed on refresh', async () => {
    const client = createFixtureStatsClient();
    const actor = start(client);
    actor.send({ type: 'resource.register', ref: prod });
    await flush(101);
    const before = actor.getSnapshot().context.entries[statsKey(prod)];
    actor.send({ type: 'refresh' });
    await flush(101);
    expect(client.calls).toHaveLength(2);
    expect(actor.getSnapshot().context.entries[statsKey(prod)]).toBe(before);
  });

  it('releases after the grace period and a re-register cancels the release', async () => {
    const actor = start(createFixtureStatsClient());
    actor.send({ type: 'resource.register', ref: prod });
    await flush(101);
    actor.send({ type: 'resource.unregister', ref: prod });
    expect(actor.getSnapshot().context.registrations[statsKey(prod)].count).toBe(0);
    await flush(500);
    actor.send({ type: 'resource.register', ref: prod });
    await flush(600);
    expect(actor.getSnapshot().context.registrations[statsKey(prod)].count).toBe(1);
    actor.send({ type: 'resource.unregister', ref: prod });
    await flush(1001);
    expect(actor.getSnapshot().context.registrations[statsKey(prod)]).toBeUndefined();
    // The cache stays after release.
    expect(actor.getSnapshot().context.entries[statsKey(prod)].phase).toBe('loaded');
  });

  it('keeps component errors and unknown codes, and never invents numbers', async () => {
    const actor = start(createFixtureStatsClient());
    const forbidden: StatsComponentRef = { kind: 'destination', id: 'forbidden' };
    const future: StatsComponentRef = { kind: 'destination', id: 'future-code' };
    actor.send({ type: 'resource.register', ref: forbidden });
    actor.send({ type: 'resource.register', ref: future });
    await flush(101);
    const { entries } = actor.getSnapshot().context;
    expect(entries[statsKey(forbidden)].error?.code).toBe('forbidden');
    expect(entries[statsKey(future)].error?.code).toBe('a_future_code');
    expect(entries[statsKey(future)].eventsPerSecond).toBeNull();
  });

  it('marks resources unavailable when the client throws, and does not loop', async () => {
    const fetchStats = jest.fn().mockRejectedValue(new Error('network down'));
    const actor = start({ fetchStats });
    actor.send({ type: 'resource.register', ref: prod });
    await flush(500);
    expect(fetchStats).toHaveBeenCalledTimes(1);
    expect(actor.getSnapshot().context.entries[statsKey(prod)]).toMatchObject({
      phase: 'loaded',
      eventsPerSecond: null,
      error: { code: 'unavailable', reason: 'network down' },
    });
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('fetches a resource that registers during a fetch in the next round', async () => {
    const client = createFixtureStatsClient({ delayMs: 50 });
    const actor = start(client);
    actor.send({ type: 'resource.register', ref: prod });
    await flush(120);
    actor.send({ type: 'resource.register', ref: dev });
    await flush(1000);
    expect(client.calls).toEqual([{ count: 1 }, { count: 1 }]);
    expect(actor.getSnapshot().context.entries[statsKey(dev)].phase).toBe('loaded');
  });

  it('chunks above the per-request cap', async () => {
    const client = createFixtureStatsClient();
    const actor = createActor(metricsManagerMachine, {
      input: { client, tuning: { poolWindowMs: 10, maxPerRequest: 2 } },
    }).start();
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      actor.send({ type: 'resource.register', ref: { kind: 'destination', id } });
    }
    await flush(50);
    expect(client.calls.map((call) => call.count).sort()).toEqual([1, 2, 2]);
  });

  it('applies a response-level error to every component', async () => {
    const client = createFixtureStatsClient({
      responseError: { code: 'forbidden', reason: 'No access.' },
    });
    const actor = start(client);
    actor.send({ type: 'resource.register', ref: prod });
    actor.send({ type: 'resource.register', ref: step });
    await flush(101);
    const { entries } = actor.getSnapshot().context;
    expect(entries[statsKey(prod)].error?.code).toBe('forbidden');
    expect(entries[statsKey(step)].error?.code).toBe('forbidden');
    expect(entries[statsKey(prod)].eventsPerSecond).toBeNull();
  });

  it('exposes a stable idle slice for unknown keys', () => {
    expect(IDLE_STATS.phase).toBe('idle');
  });
});
