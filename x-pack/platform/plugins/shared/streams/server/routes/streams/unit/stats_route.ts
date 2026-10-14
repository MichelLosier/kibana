/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StreamsUnit } from '@kbn/streams-schema';
import { streamsUnitIdentifierSchema, streamsUnitStatsRequestSchema } from '@kbn/streams-schema';
import { z } from '@kbn/zod/v4';
import { STREAMS_API_PRIVILEGES } from '../../../../common/constants';
import { StreamsUnitService } from '../../../lib/saved_objects/streams_unit_service';
import { getUnitStats } from '../../../lib/unit_stats/get_unit_stats';
import { createServerRoute } from '../../create_server_route';
import { assertStreamsCanvasEnabled } from './assert_streams_canvas_enabled';

export const getStreamsUnitStatsRoute = createServerRoute({
  endpoint: 'POST /internal/streams/unit/{id}/_stats',
  options: {
    access: 'internal',
    summary: 'Get stats for resources in a Streams unit',
    description:
      'Returns one result per requested destination or processor, with a status and metric rows. Reads the Streams stats data stream as the current user.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    path: z.object({
      id: streamsUnitIdentifierSchema.describe('The unit id.'),
    }),
    body: streamsUnitStatsRequestSchema,
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    logger,
  }): Promise<StreamsUnit.StatsResponse> => {
    const { soClient, uiSettingsClient, scopedClusterClient } = await getScopedClients({
      request,
    });

    await assertStreamsCanvasEnabled(uiSettingsClient);

    const streamsUnitService = new StreamsUnitService({ soClient, logger });
    const { unit } = await streamsUnitService.getUnit(params.path.id);

    return await getUnitStats({
      unitId: params.path.id,
      unit,
      request: params.body,
      esClient: scopedClusterClient.asCurrentUser,
      logger,
    });
  },
});

export const unitStatsRoutes = {
  ...getStreamsUnitStatsRoute,
};
