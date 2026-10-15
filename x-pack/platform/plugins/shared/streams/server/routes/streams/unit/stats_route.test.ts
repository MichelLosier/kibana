/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { stripNullishRequestParameters } from '@kbn/server-route-repository/src/strip_nullish_request_parameters';
import { getStreamsUnitStatsRoute } from './stats_route';

jest.mock('../../../lib/saved_objects/streams_unit_service', () => ({
  StreamsUnitService: jest.fn().mockImplementation(() => ({
    getUnit: async () => ({
      unit: {
        sources: [],
        destinations: [{ id: 'es-prod', type: 'debug', supported_telemetry: ['logs'] }],
        processors: [],
        pipelines: [],
      },
      ui_metadata: {},
    }),
  })),
}));

const route = getStreamsUnitStatsRoute['POST /internal/streams/unit/{id}/_stats'];

describe('POST /internal/streams/unit/{id}/_stats handler', () => {
  it('route repository drops an empty body, so the handler sees no body for {}', () => {
    const params = stripNullishRequestParameters({
      params: { id: 'default' },
      body: {},
      query: {},
    });
    expect(params).toEqual({ path: { id: 'default' } });
  });

  it('treats a missing body as the empty request (regression: {} gave 500)', async () => {
    const search = jest.fn().mockResolvedValue({ hits: { hits: [] } });
    const response = await route.handler({
      params: { path: { id: 'default' } },
      request: {},
      logger: loggingSystemMock.createLogger(),
      telemetry: { startTrackingEndpointLatency: () => () => {} },
      getScopedClients: async () => ({
        uiSettingsClient: { get: async () => true },
        soClient: {},
        scopedClusterClient: { asCurrentUser: { search } },
      }),
    } as never);
    // `{}` means every component in the unit. The debug destination emits no stats.
    expect(Object.keys(response.components.destinations)).toEqual(['es-prod']);
    expect(response.components.destinations['es-prod'].error?.code).toBe('unsupported');
  });
});
