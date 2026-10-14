/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  classifyDocsError,
  fetchDestinationDocsHistogram,
  formatDocsSummary,
  sumHistogramDocs,
} from './destination_docs';

jest.mock('../../hooks/use_execute_esql_query', () => ({
  executeEsqlQuery: jest.fn().mockResolvedValue({ columns: [], values: [] }),
}));

describe('destination docs', () => {
  it('uses a 15 minute range and a 1 minute bucket with the classic helpers', async () => {
    const { executeEsqlQuery } = jest.requireMock('../../hooks/use_execute_esql_query');
    const now = Date.UTC(2026, 9, 14, 12, 0, 0);
    const result = await fetchDestinationDocsHistogram({
      index: 'logs-application.otel-prod',
      search: jest.fn() as never,
      uiSettings: { get: () => 'Browser' } as never,
      now,
    });
    expect(result.bucketMs).toBe(60_000);
    expect(result.end - result.start).toBe(15 * 60_000);
    expect(executeEsqlQuery.mock.calls[0][0].query).toContain('FROM logs-application.otel-prod');
    expect(executeEsqlQuery.mock.calls[0][0].query).toContain('BUCKET(@timestamp, 60000 ms)');
    expect(executeEsqlQuery.mock.calls[0][0].query).not.toContain('::failures');
  });

  it('sums the doc_count column', () => {
    expect(
      sumHistogramDocs({
        columns: [
          { name: 'doc_count', type: 'long' },
          { name: '@timestamp', type: 'date' },
        ],
        values: [
          [30, 'a'],
          [2, 'b'],
        ],
      } as never)
    ).toBe(32);
  });

  it('shows a dash for missing data and never zero', () => {
    expect(formatDocsSummary({ kind: 'missing', reason: 'no_index' })).toBe('–');
    expect(formatDocsSummary({ kind: 'missing', reason: 'unknown_index' })).toBe('–');
    expect(formatDocsSummary({ kind: 'loading' })).toBe('…');
  });

  it('shows total and window counts separately', () => {
    expect(formatDocsSummary({ kind: 'ready', windowDocs: 30, totalDocs: 1234 })).toBe(
      '1,234 total · 30 in 15m'
    );
    expect(formatDocsSummary({ kind: 'ready', windowDocs: 0 })).toBe('– total · 0 in 15m');
  });

  it.each([
    ['verification_exception: Unknown index [x]', 'unknown_index'],
    ['security_exception ... forbidden', 'forbidden'],
    ['boom', 'error'],
  ])('classifies %p as %p', (message, reason) => {
    expect(classifyDocsError(new Error(message))).toMatchObject({ kind: 'missing', reason });
  });
});
