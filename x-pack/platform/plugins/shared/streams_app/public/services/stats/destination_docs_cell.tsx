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
import { countRender } from './render_counter';
import { useRegisterStats, useStatsFor } from './stats_context';
import type { ComponentStats, StatsComponentRef, StatsSeries } from './types';

export const NO_DOCS_TEXT = '–';

/** Total beneath the bars. The sum of the points, so it agrees with them. */
export const formatDocsTotal = (stats: ComponentStats): string => {
  if (stats.phase === 'loading') return '…';
  if (stats.phase !== 'loaded' || stats.error || stats.totalEvents === null) return NO_DOCS_TEXT;
  return stats.totalEvents.toLocaleString();
};

/**
 * The one chart mapper. Points[i].start becomes x, value becomes y, bucket width becomes
 * `minInterval` and the response window becomes `xDomain`. A bucket with no documents has
 * no point and needs no zero fill.
 */
export const toChartProps = (series: StatsSeries) => ({
  data: series.points.map((point) => ({ x: point.x, doc_count: point.value })),
  xDomain: { min: series.window.start, max: series.window.end, minInterval: series.bucketMs },
});

/**
 * Docs cell for a destination: a histogram with the total beneath. It reads the `_stats`
 * series through the stats manager, so it shares one request with the Throughput column.
 * No data or an error shows a dash, never zero.
 */
export const DestinationDocsCell = ({ id }: { id: string }) => {
  countRender(`docs:${id}`);
  const chartBaseTheme = useElasticChartsTheme();
  const ref = useMemo<StatsComponentRef>(() => ({ kind: 'destination', id }), [id]);
  const refs = useMemo(() => [ref], [ref]);
  useRegisterStats(refs);
  const stats = useStatsFor(ref);

  const chart =
    stats.series && stats.series.points.length > 0 ? toChartProps(stats.series) : undefined;

  return (
    <div data-test-subj="streamsDestinationDocs" data-stats-phase={stats.phase}>
      <div style={{ height: 20, width: '100%' }}>
        {chart && !stats.error && (
          <Chart size={{ width: '100%', height: 20 }}>
            <Settings
              baseTheme={chartBaseTheme}
              theme={{ background: { color: 'transparent' } }}
              xDomain={chart.xDomain}
              noResults={<div />}
            />
            <Tooltip stickTo={TooltipStickTo.Middle} />
            <BarSeries
              id="docs"
              xScaleType={ScaleType.Time}
              yScaleType={ScaleType.Linear}
              xAccessor="x"
              yAccessors={['doc_count']}
              data={chart.data}
              enableHistogramMode
            />
          </Chart>
        )}
      </div>
      <span data-test-subj="streamsDestinationDocsText">
        {stats.error ? (
          <EuiIconTip
            content={stats.error.reason}
            type="warning"
            color="warning"
            aria-label={stats.error.code}
          />
        ) : (
          formatDocsTotal(stats)
        )}
      </span>
    </div>
  );
};
