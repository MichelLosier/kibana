/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { createFixtureStatsClient } from '../../../../../services/stats/fixture_stats_client';
import { StatsManagerProvider } from '../../../../../services/stats';
import type { DestinationNode as DestinationNodeType } from '../types';
import { DestinationNode } from './destination_node';

const renderNode = (data: DestinationNodeType['data'], client = createFixtureStatsClient()) =>
  render(
    <ReactFlowProvider>
      <StatsManagerProvider client={client}>
        <DestinationNode
          {...({ data, selected: false, dragging: false } as NodeProps<DestinationNodeType>)}
        />
      </StatsManagerProvider>
    </ReactFlowProvider>
  );

describe('destination node stats', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.__STREAMS_STATS_DEBUG__ = true;
    window.__streamsStatsRenders = {};
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    window.__STREAMS_STATS_DEBUG__ = false;
    jest.restoreAllMocks();
  });

  it('shows rate and latency from the manager without re-rendering the node', async () => {
    const client = createFixtureStatsClient();
    renderNode({ destinationId: 'es-prod', title: 'Prod' }, client);
    expect(screen.getByTestId('streamsStatsText').textContent).toBe('–');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(screen.getByTestId('streamsStatsText').textContent).toBe('18 eps · 15ms');
    expect(client.calls).toEqual([{ count: 1 }]);
    // The node itself rendered once. Only the stats child re-rendered.
    expect(window.__streamsStatsRenders?.['node-render:es-prod']).toBe(1);
    expect(window.__streamsStatsRenders?.['destination:es-prod']).toBeGreaterThan(1);
  });

  it('shows a dash for no_data and nothing for classic or unconfigured nodes', async () => {
    renderNode({ destinationId: 'es-dev', title: 'Dev' });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    const text = screen.getByTestId('streamsStatsText');
    expect(text.textContent).toBe('–');
    expect(text.getAttribute('data-stats-phase')).toBe('loaded');
    expect(text.getAttribute('data-stats-error')).toBeNull();
  });

  it('does not render stats without a unit destination id', () => {
    renderNode({ title: 'Classic', streamName: 'logs' });
    expect(screen.queryByTestId('streamsStatsText')).toBeNull();
  });
});
