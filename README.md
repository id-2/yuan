# Yuan Voice-to-Code Orchestrator

This workspace now supports routing requests to either Claude Code or ChatGPT Codex.
Use wake words like `codex, ...` or `claude, ...` in your text/voice instructions to
pick the agent. Set `OPENAI_API_KEY` (and optional `CODEX_MODEL`) to enable Codex
alongside `ANTHROPIC_API_KEY`.
