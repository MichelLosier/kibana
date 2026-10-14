/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import { EuiIconTip } from '@elastic/eui';
import { BarSeries, Chart, ScaleType, Settings, Tooltip, TooltipStickTo } from '@elastic/charts';
import { useElasticChartsTheme } from '@kbn/charts-theme';
import useAsync from 'react-use/lib/useAsync';
import { useKibana } from '../../hooks/use_kibana';
import {
  classifyDocsError,
  DESTINATION_DOCS_RANGE_MS,
  fetchDestinationDocsHistogram,
  formatDocsSummary,
  sumHistogramDocs,
  type DocsCellState,
} from './destination_docs';
import { countRender } from './render_counter';

interface Point {
  x: number;
  doc_count: number;
}

const toPoints = (columns: Array<{ name: string }>, values: unknown[][]): Point[] => {
  const t = columns.findIndex((c) => c.name === '@timestamp');
  const c = columns.findIndex((col) => col.name === 'doc_count');
  if (t < 0 || c < 0) return [];
  return values.map((row) => ({
    x: new Date(row[t] as string).getTime(),
    doc_count: Number(row[c]),
  }));
};

/**
 * Docs cell for a destination with a static index: a histogram of stored documents in
 * the last 15 minutes with the all-time total beneath. It loads on mount, so the data
 * grid fetches only for rows that are on screen. Missing data shows a dash or a warning
 * icon, never zero.
 */
export const DestinationDocsCell = ({ index }: { index?: string }) => {
  countRender(`docs:${index ?? 'none'}`);
  const chartBaseTheme = useElasticChartsTheme();
  const {
    core: { uiSettings },
    dependencies: {
      start: {
        data,
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();

  const result = useAsync(async (): Promise<
    | { state: DocsCellState; points: Point[]; start: number; end: number; bucketMs: number }
    | undefined
  > => {
    if (!index) return undefined;
    const controller = new AbortController();
    try {
      const [histogram, totals] = await Promise.all([
        fetchDestinationDocsHistogram({
          index,
          search: data.search.search,
          uiSettings,
          signal: controller.signal,
        }),
        // Resolves to an empty list for an unknown name. It rejects for 403.
        streamsRepositoryClient
          .fetch('GET /internal/streams/doc_counts/total', {
            signal: controller.signal,
            params: { query: { stream: index } },
          })
          .catch(() => undefined),
      ]);
      const totalDocs = totals?.find((entry) => entry.stream === index)?.count;
      return {
        state: { kind: 'ready', windowDocs: sumHistogramDocs(histogram.response), totalDocs },
        points: toPoints(histogram.response.columns, histogram.response.values),
        start: histogram.start,
        end: histogram.end,
        bucketMs: histogram.bucketMs,
      };
    } catch (error) {
      return { state: classifyDocsError(error), points: [], start: 0, end: 0, bucketMs: 0 };
    }
  }, [index, data.search.search, streamsRepositoryClient, uiSettings]);

  const state: DocsCellState = useMemo(() => {
    if (!index) return { kind: 'missing', reason: 'no_index' };
    if (result.loading) return { kind: 'loading' };
    return result.value?.state ?? { kind: 'missing', reason: 'error' };
  }, [index, result.loading, result.value]);

  const text = formatDocsSummary(state);
  const points = result.value?.points ?? [];

  return (
    <div data-test-subj="streamsDestinationDocs" data-docs-state={state.kind}>
      <div style={{ height: 20, width: '100%' }}>
        {state.kind === 'ready' && points.length > 0 && result.value && (
          <Chart size={{ width: '100%', height: 20 }}>
            <Settings
              baseTheme={chartBaseTheme}
              theme={{ background: { color: 'transparent' } }}
              xDomain={{
                min: result.value.start,
                max: result.value.end,
                minInterval: result.value.bucketMs,
              }}
              noResults={<div />}
            />
            <Tooltip stickTo={TooltipStickTo.Middle} />
            <BarSeries
              id="docs"
              xScaleType={ScaleType.Time}
              yScaleType={ScaleType.Linear}
              xAccessor="x"
              yAccessors={['doc_count']}
              data={points}
              enableHistogramMode
            />
          </Chart>
        )}
      </div>
      <span data-test-subj="streamsDestinationDocsText">
        {state.kind === 'missing' && state.reason === 'forbidden' ? (
          <EuiIconTip
            content={state.message}
            type="warning"
            color="warning"
            aria-label="No access"
          />
        ) : (
          text
        )}
      </span>
    </div>
  );
};

export { DESTINATION_DOCS_RANGE_MS };
