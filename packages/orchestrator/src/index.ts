import 'dotenv/config';
import { OrchestratorServer } from './server.js';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

async function main(): Promise<void> {
  console.log('Starting Claude Code Orchestrator...');

  if (process.env.OPENAI_API_KEY) {
    console.log('ChatGPT Codex support is enabled.');
  } else {
    console.log('ChatGPT Codex support not configured (missing OPENAI_API_KEY).');
  }

  const server = new OrchestratorServer({
    port: parseInt(getOptionalEnv('ORCHESTRATOR_PORT', '3000'), 10),
    secret: getRequiredEnv('ORCHESTRATOR_SECRET'),
    anthropicApiKey: getRequiredEnv('ANTHROPIC_API_KEY'),
    openaiApiKey: process.env.OPENAI_API_KEY,
    codexModel: process.env.CODEX_MODEL,
    workingDirectory: process.env.WORKING_DIRECTORY || process.cwd(),
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.start();
  console.log('Orchestrator is running and ready to receive instructions.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
