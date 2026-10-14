/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect, useMemo } from 'react';
import { createActorContext } from '@xstate/react';
import { metricsManagerMachine } from './metrics_manager_machine';
import type { ResourceStats, StatsClient, StatsResourceRef } from './types';
import { isStatsDebug } from './render_counter';
import { IDLE_STATS, statsKey } from './types';

/**
 * Debug log for the manager. Turn it on in the browser console with
 * `window.__STREAMS_STATS_DEBUG__ = true`. It logs one line per snapshot.
 */
declare global {
  interface Window {
    __STREAMS_STATS_DEBUG__?: boolean;
  }
}

const StatsManagerContext = createActorContext(metricsManagerMachine);

const DebugLogger = () => {
  const actorRef = StatsManagerContext.useActorRef();
  useEffect(() => {
    const subscription = actorRef.subscribe((snapshot) => {
      if (isStatsDebug()) {
        // eslint-disable-next-line no-console
        console.debug('[streams-stats]', {
          state: snapshot.value,
          requests: snapshot.context.requestCount,
          registered: Object.values(snapshot.context.registrations).map(
            (r) => `${r.ref.type}:${r.ref.id}x${r.count}`
          ),
          entries: Object.fromEntries(
            Object.entries(snapshot.context.entries).map(([key, entry]) => [
              key.replace(/\u0000/g, '/'),
              entry.status,
            ])
          ),
        });
      }
    });
    return () => subscription.unsubscribe();
  }, [actorRef]);
  return null;
};

/**
 * One manager above the tabs, so the Map and the tables share one cache.
 * Memoise `provide` input on the client: `createActorContext` reads `logic`
 * and `options` on first render only (verify in Checkpoint C).
 */
export const StatsManagerProvider = ({
  client,
  children,
}: React.PropsWithChildren<{ client: StatsClient }>) => {
  const options = useMemo(() => ({ input: { client } }), [client]);
  return (
    <StatsManagerContext.Provider options={options}>
      <DebugLogger />
      {children}
    </StatsManagerContext.Provider>
  );
};

/** Select one slice. A stable `IDLE_STATS` reference stops renders for unknown keys. */
export const useStatsFor = (ref: StatsResourceRef): ResourceStats => {
  const key = statsKey(ref);
  return StatsManagerContext.useSelector((snapshot) => snapshot.context.entries[key] ?? IDLE_STATS);
};

/** Registers refs while mounted. Several components may register the same ref. */
export const useRegisterStats = (refs: StatsResourceRef[]) => {
  const actorRef = StatsManagerContext.useActorRef();
  // Re-run only when the set of keys changes, not on every new array.
  const keys = refs.map(statsKey).join('\u0001');
  useEffect(() => {
    const current = refs;
    current.forEach((ref) => actorRef.send({ type: 'resource.register', ref }));
    return () => {
      current.forEach((ref) => actorRef.send({ type: 'resource.unregister', ref }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorRef, keys]);
};

export const useStatsManagerRef = StatsManagerContext.useActorRef;
