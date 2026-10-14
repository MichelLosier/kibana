/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isEqual } from 'lodash';
import { assign, fromPromise, raise, setup } from 'xstate';
import { entriesForFailure } from './map_stats_response';
import type { ResourceStats, StatsClient, StatsFetchResult, StatsResourceRef } from './types';
import { statsKey } from './types';

/** All tuning in one place. Spike values. No polling yet. */
export const STATS_TUNING = {
  poolWindowMs: 150,
  graceMs: 5_000,
  maxPerRequest: 100,
} as const;

export type StatsTuning = { -readonly [K in keyof typeof STATS_TUNING]: number };

interface Registration {
  ref: StatsResourceRef;
  count: number;
  /** Set when the count reaches zero. A sweep drops the registration after it. */
  releaseAt?: number;
}

export interface MetricsManagerContext {
  client: StatsClient;
  tuning: StatsTuning;
  /** What components read. Unchanged entries keep their object reference. */
  entries: Record<string, ResourceStats>;
  /** Bookkeeping that components never read. */
  registrations: Record<string, Registration>;
  /** Keys in the request that is in flight. */
  inFlight: string[];
  forceRefresh: boolean;
  /** Number of requests sent. For tests and the debug log. */
  requestCount: number;
}

export type MetricsManagerEvent =
  | { type: 'resource.register'; ref: StatsResourceRef }
  | { type: 'resource.unregister'; ref: StatsResourceRef }
  | { type: 'grace.sweep' }
  | { type: 'refresh' };

const LOADING: ResourceStats = { status: 'loading', metrics: [] };

/** Keys that are registered and have no data yet (or all of them on refresh). */
const keysToFetch = (context: MetricsManagerContext): string[] =>
  Object.entries(context.registrations)
    .filter(([key, registration]) => {
      if (registration.count <= 0) return false;
      if (context.forceRefresh) return true;
      const entry = context.entries[key];
      return entry === undefined || entry.status === 'idle';
    })
    .map(([key]) => key);

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

/** Reuse the old entry object when nothing but the timestamp changed. */
const sameContent = (a: ResourceStats, b: ResourceStats) =>
  a.status === b.status &&
  a.reason === b.reason &&
  a.windowSeconds === b.windowSeconds &&
  isEqual(a.metrics, b.metrics);

const mergeEntries = (
  current: Record<string, ResourceStats>,
  incoming: Record<string, ResourceStats>
): Record<string, ResourceStats> => {
  const next = { ...current };
  let changed = false;
  for (const [key, entry] of Object.entries(incoming)) {
    const old = current[key];
    if (old && sameContent(old, entry)) continue;
    next[key] = entry;
    changed = true;
  }
  return changed ? next : current;
};

export const metricsManagerMachine = setup({
  types: {
    context: {} as MetricsManagerContext,
    events: {} as MetricsManagerEvent,
    input: {} as { client: StatsClient; tuning?: Partial<StatsTuning> },
  },
  actors: {
    fetchStats: fromPromise<
      StatsFetchResult,
      { client: StatsClient; resources: StatsResourceRef[]; maxPerRequest: number }
    >(async ({ input, signal }) => {
      // One request per chunk. Above the cap this is the safety net. A failed chunk
      // marks only its resources.
      const results = await Promise.all(
        chunk(input.resources, input.maxPerRequest).map((resources) =>
          input.client.fetchStats({ resources, signal }).catch((error: unknown) => {
            if (signal.aborted) throw error;
            return {
              entries: entriesForFailure(
                resources,
                'unavailable',
                error instanceof Error ? error.message : 'Stats request failed',
                Date.now()
              ),
            };
          })
        )
      );
      return { entries: Object.assign({}, ...results.map((result) => result.entries)) };
    }),
  },
  actions: {
    addRegistration: assign({
      registrations: ({ context }, params: { ref: StatsResourceRef }) => {
        const key = statsKey(params.ref);
        const existing = context.registrations[key];
        return {
          ...context.registrations,
          [key]: { ref: params.ref, count: (existing?.count ?? 0) + 1 },
        };
      },
    }),
    removeRegistration: assign({
      registrations: ({ context }, params: { ref: StatsResourceRef }) => {
        const key = statsKey(params.ref);
        const existing = context.registrations[key];
        if (!existing || existing.count <= 0) return context.registrations;
        const count = existing.count - 1;
        return {
          ...context.registrations,
          [key]: {
            ...existing,
            count,
            ...(count === 0 ? { releaseAt: Date.now() + context.tuning.graceMs } : {}),
          },
        };
      },
    }),
    scheduleSweep: raise(
      { type: 'grace.sweep' },
      { delay: ({ context }) => context.tuning.graceMs }
    ),
    sweep: assign({
      registrations: ({ context }) => {
        const now = Date.now();
        return Object.fromEntries(
          Object.entries(context.registrations).filter(
            ([, registration]) =>
              registration.count > 0 ||
              registration.releaseAt === undefined ||
              registration.releaseAt > now
          )
        );
      },
    }),
    markLoading: assign(({ context }) => {
      const keys = keysToFetch(context);
      const entries = { ...context.entries };
      for (const key of keys) {
        // Only the first load shows `loading`. A refresh keeps the old value.
        if (!entries[key] || entries[key].status === 'idle') entries[key] = LOADING;
      }
      return {
        entries,
        inFlight: keys,
        forceRefresh: false,
        requestCount: context.requestCount + 1,
      };
    }),
    mergeResult: assign({
      entries: ({ context }, params: { result: StatsFetchResult }) =>
        mergeEntries(context.entries, params.result.entries),
      inFlight: [] as string[],
    }),
    markFailed: assign({
      entries: ({ context }, params: { message: string }) => {
        const next = { ...context.entries };
        for (const key of context.inFlight) {
          const old = next[key];
          next[key] =
            old && (old.status === 'ready' || old.status === 'stale')
              ? { ...old, status: 'stale', reason: params.message }
              : { status: 'unavailable', metrics: [], reason: params.message };
        }
        return next;
      },
      inFlight: [] as string[],
    }),
    requestRefresh: assign({ forceRefresh: true }),
  },
  guards: {
    hasKeysToFetch: ({ context }) => keysToFetch(context).length > 0,
  },
  delays: {
    poolWindow: ({ context }) => context.tuning.poolWindowMs,
  },
}).createMachine({
  id: 'streamsMetricsManager',
  context: ({ input }) => ({
    client: input.client,
    tuning: { ...STATS_TUNING, ...input.tuning },
    entries: {},
    registrations: {},
    inFlight: [],
    forceRefresh: false,
    requestCount: 0,
  }),
  initial: 'idle',
  on: {
    'resource.register': {
      actions: [{ type: 'addRegistration', params: ({ event }) => ({ ref: event.ref }) }],
    },
    'resource.unregister': {
      actions: [
        { type: 'removeRegistration', params: ({ event }) => ({ ref: event.ref }) },
        'scheduleSweep',
      ],
    },
    'grace.sweep': { actions: 'sweep' },
  },
  states: {
    idle: {
      // `idle` holds no timers and no actors.
      on: {
        'resource.register': {
          target: 'pooling',
          actions: [{ type: 'addRegistration', params: ({ event }) => ({ ref: event.ref }) }],
        },
        refresh: { target: 'pooling', actions: 'requestRefresh' },
      },
    },
    pooling: {
      // The window never resets, so a long pan cannot starve the request.
      after: {
        poolWindow: [{ guard: 'hasKeysToFetch', target: 'fetching' }, { target: 'idle' }],
      },
      on: { refresh: { actions: 'requestRefresh' } },
    },
    fetching: {
      entry: 'markLoading',
      invoke: {
        src: 'fetchStats',
        input: ({ context }) => ({
          client: context.client,
          maxPerRequest: context.tuning.maxPerRequest,
          resources: context.inFlight.map((key) => context.registrations[key].ref),
        }),
        onDone: {
          target: 'settling',
          actions: [{ type: 'mergeResult', params: ({ event }) => ({ result: event.output }) }],
        },
        onError: {
          target: 'settling',
          actions: [
            {
              type: 'markFailed',
              params: ({ event }) => ({
                message: event.error instanceof Error ? event.error.message : 'Stats failed',
              }),
            },
          ],
        },
      },
    },
    settling: {
      // Registrations that arrived during the fetch get their own round right away.
      always: [{ guard: 'hasKeysToFetch', target: 'pooling' }, { target: 'idle' }],
    },
  },
});
