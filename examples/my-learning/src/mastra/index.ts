import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';

import { learningAgent } from './agents/learning-agent';

export const mastra = new Mastra({
  agents: {
    learningAgent,
  },
  storage: new LibSQLStore({
    id: 'my-learning-storage',
    url: 'file:./mastra.db',
  }),
  logger: new PinoLogger({
    name: 'my-learning',
    level: 'info',
  }),
  server: {
    build: {
      openAPIDocs: true,
      swaggerUI: true,
    },
  },
});
