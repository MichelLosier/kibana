/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { createFixtureStatsClient } from './fixture_stats_client';
import { StatsManagerProvider, useRegisterStats, useStatsFor } from './stats_context';
import type { StatsResourceRef } from './types';

const prod: StatsResourceRef = { type: 'destination', id: 'es-prod' };

describe('stats provider and hooks', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('two consumers of one resource share one request and render the value', async () => {
    const client = createFixtureStatsClient();
    const renders = { a: 0, b: 0 };
    const Consumer = ({ name }: { name: 'a' | 'b' }) => {
      renders[name]++;
      useRegisterStats([prod]);
      const stats = useStatsFor(prod);
      return <span data-test-subj={`status-${name}`}>{stats.status}</span>;
    };

    render(
      <StatsManagerProvider client={client}>
        <Consumer name="a" />
        <Consumer name="b" />
      </StatsManagerProvider>
    );
    expect(screen.getByTestId('status-a').textContent).toBe('idle');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByTestId('status-a').textContent).toBe('ready');
    expect(screen.getByTestId('status-b').textContent).toBe('ready');
    expect(client.calls).toEqual([{ count: 1 }]);
    // idle, loading, ready for each consumer. A third state change would mean extra renders.
    expect(renders.a).toBeLessThanOrEqual(3);
  });
});
