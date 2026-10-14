/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ISearchGeneric } from '@kbn/search-types';
import type { IUiSettingsClient } from '@kbn/core/public';
import { UI_SETTINGS } from '@kbn/data-plugin/public';
import type { UnparsedEsqlResponse } from '@kbn/traced-es-client';
import { executeEsqlQuery } from '../../hooks/use_execute_esql_query';
import { STREAMS_HISTOGRAM_NUM_DATA_POINTS } from '../../hooks/use_streams_doc_counts_fetch';
import {
  buildStreamIngestHistogramEsql,
  getMeaningfulBucketMs,
} from '../../util/stream_overview_esql';

/**
 * Docs column for destination rows. Spike. Data comes from the destination's index
 * (stored documents), not from the collector metrics.
 *
 * The destination view has no time picker, so the range is fixed at 15 minutes, which
 * matches the stats window. With classic's `getMeaningfulBucketMs` that range gives a
 * 1 minute bucket (15 minutes is not below the 15 minute breakpoint).
 */
export const DESTINATION_DOCS_RANGE_MS = 15 * 60 * 1000;

export interface DestinationDocsHistogram {
  bucketMs: number;
  start: number;
  end: number;
  response: UnparsedEsqlResponse;
}

export const fetchDestinationDocsHistogram = async ({
  index,
  search,
  uiSettings,
  signal,
  now = Date.now(),
}: {
  index: string;
  search: ISearchGeneric;
  uiSettings: IUiSettingsClient;
  signal?: AbortSignal;
  now?: number;
}): Promise<DestinationDocsHistogram> => {
  const start = now - DESTINATION_DOCS_RANGE_MS;
  const bucketMs = getMeaningfulBucketMs(
    DESTINATION_DOCS_RANGE_MS,
    STREAMS_HISTOGRAM_NUM_DATA_POINTS
  );
  // No `::failures` source here. A plain data stream may have no failure store, and
  // a missing failure index would add an "Unknown index" error.
  const response = (await executeEsqlQuery({
    query: buildStreamIngestHistogramEsql(index, bucketMs),
    search,
    signal,
    start,
    end: now,
    timezone: uiSettings.get<string>(UI_SETTINGS.DATEFORMAT_TZ),
    uiSettings,
  })) as UnparsedEsqlResponse;
  return { bucketMs, start, end: now, response };
};

/** Sums the `doc_count` column of the histogram response. */
export const sumHistogramDocs = (response: UnparsedEsqlResponse): number => {
  const column = response.columns.findIndex((col) => col.name === 'doc_count');
  if (column < 0) return 0;
  return response.values.reduce((total, row) => total + Number(row[column] ?? 0), 0);
};

export type DocsCellState =
  | { kind: 'loading' }
  | {
      kind: 'missing';
      reason: 'no_index' | 'unknown_index' | 'forbidden' | 'error';
      message?: string;
    }
  | { kind: 'ready'; windowDocs: number; totalDocs?: number };

export const classifyDocsError = (error: unknown): DocsCellState => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Unknown index') || message.includes('index_not_found_exception')) {
    return { kind: 'missing', reason: 'unknown_index', message };
  }
  if (
    message.includes('security_exception') ||
    message.includes('403') ||
    /forbidden/i.test(message)
  ) {
    return { kind: 'missing', reason: 'forbidden', message };
  }
  return { kind: 'missing', reason: 'error', message };
};

/**
 * Text beneath the histogram. The total is all time (metering or index stats). The
 * window count is the histogram sum. They differ on purpose, so both show.
 */
export const formatDocsSummary = (state: DocsCellState): string => {
  switch (state.kind) {
    case 'loading':
      return '…';
    case 'missing':
      return '–';
    case 'ready': {
      const total = state.totalDocs === undefined ? '–' : state.totalDocs.toLocaleString();
      return `${total} total · ${state.windowDocs.toLocaleString()} in 15m`;
    }
  }
};
