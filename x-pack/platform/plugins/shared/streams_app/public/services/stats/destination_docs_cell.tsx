/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import { EuiIconTip } from '@elastic/eui';
import {
  BarSeries,
  Chart,
  niceTimeFormatter,
  ScaleType,
  Settings,
  Tooltip,
  TooltipStickTo,
} from '@elastic/charts';
import { i18n } from '@kbn/i18n';
import { useElasticChartsTheme } from '@kbn/charts-theme';
import { countRender } from './render_counter';
import { useRegisterStats, useStatsFor } from './stats_context';
import type { ComponentStats, StatsComponentRef, StatsSeries } from './types';

export const NO_DOCS_TEXT = '–';

const DOCS_SERIES_NAME = i18n.translate('xpack.streams.destinations.docsCell.seriesName', {
  defaultMessage: 'Documents',
});

/** Total beneath the bars, in the design's form: `1,221,223 docs`. The sum of the points. */
export const formatDocsTotal = (stats: ComponentStats): string => {
  if (stats.phase === 'loading') return '…';
  if (stats.phase !== 'loaded' || stats.error || stats.totalEvents === null) return NO_DOCS_TEXT;
  return i18n.translate('xpack.streams.destinations.docsCell.totalLabel', {
    defaultMessage: '{count, number} {count, plural, one {doc} other {docs}}',
    values: { count: stats.totalEvents },
  });
};

/** Tooltip header over the bars: a readable time, never an epoch number. Same as classic. */
export const getTooltipHeaderFormatter = (series: StatsSeries) => {
  const format = niceTimeFormatter([series.window.start, series.window.end]);
  return ({ value }: { value: number }) => format(value);
};

/** Title for the cell: the window the numbers cover. */
export const formatWindowTitle = (series: StatsSeries): string =>
  i18n.translate('xpack.streams.destinations.docsCell.windowTitle', {
    defaultMessage: 'Documents processed from {start} to {end}',
    values: {
      start: new Date(series.window.start).toLocaleString(),
      end: new Date(series.window.end).toLocaleString(),
    },
  });

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
    // One block: the chart and the total share the same left edge and width.
    <div
      data-test-subj="streamsDestinationDocs"
      data-stats-phase={stats.phase}
      title={stats.series ? formatWindowTitle(stats.series) : undefined}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%' }}
    >
      <div style={{ height: 22, width: '100%' }}>
        {chart && !stats.error && stats.series && (
          <Chart size={{ width: '100%', height: 22 }}>
            <Settings
              baseTheme={chartBaseTheme}
              theme={{ background: { color: 'transparent' } }}
              xDomain={chart.xDomain}
              noResults={<div />}
            />
            <Tooltip
              stickTo={TooltipStickTo.Middle}
              headerFormatter={getTooltipHeaderFormatter(stats.series)}
            />
            <BarSeries
              id="docs"
              name={DOCS_SERIES_NAME}
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
      <span
        data-test-subj="streamsDestinationDocsText"
        style={{ textAlign: 'left', lineHeight: '16px', whiteSpace: 'nowrap' }}
      >
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
