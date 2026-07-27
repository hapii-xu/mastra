import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

/**
 * Echo tool — no external API. Good for verifying tool loop in Studio.
 * Pair with docs/learning/02-tools and 07-loop.
 */
export const echoTool = createTool({
  id: 'echo',
  description: 'Echo the input message back unchanged',
  inputSchema: z.object({
    message: z.string().describe('Text to echo'),
  }),
  outputSchema: z.object({
    message: z.string(),
  }),
  execute: async ({ message }) => {
    return { message };
  },
});

export const learningAgent = new Agent({
  id: 'learning-agent',
  name: 'Learning Agent',
  instructions: [
    'You are a friendly Mastra learning assistant.',
    'When asked to echo something, use the echo tool.',
    'Keep answers short while the user is exploring the framework.',
  ].join(' '),
  model: 'zai-coding-plan/glm-4.5-air',
  tools: { echoTool },
});
