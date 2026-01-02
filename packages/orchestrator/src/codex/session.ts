import { EventEmitter } from 'events';
import OpenAI from 'openai';
import type {
  AgentType,
  ConversationMessage,
  OrchestratorUpdate,
} from '../types.js';
import { SessionManager } from '../state/session.js';
import { IntentParser } from '../claude-code/parser.js';
import { ApprovalDetector } from '../approval/detector.js';
import type { ApprovalGate } from '../approval/gate.js';

interface CodexSessionConfig {
  openaiApiKey: string;
  model?: string;
  workingDirectory?: string;
  sessionManager?: SessionManager;
  approvalGate: ApprovalGate;
  agentType?: AgentType;
}

export class CodexSession extends EventEmitter {
  private client: OpenAI;
  private model: string;
  private sessionManager: SessionManager;
  private intentParser: IntentParser;
  private approvalDetector: ApprovalDetector;
  private approvalGate: ApprovalGate;
  private conversationHistory: ConversationMessage[] = [];
  private isProcessing = false;
  private agentType: AgentType;

  constructor(config: CodexSessionConfig) {
    super();
    this.client = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.model ?? 'gpt-4o-mini';
    this.sessionManager = config.sessionManager ?? new SessionManager();
    this.intentParser = new IntentParser(this.sessionManager);
    this.approvalDetector = new ApprovalDetector();
    this.approvalGate = config.approvalGate;
    this.agentType = config.agentType ?? 'codex';
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }

  async processInstruction(instruction: string, userId: string): Promise<void> {
    if (this.isProcessing) {
      this.emit('update', {
        type: 'ERROR',
        userId,
        message: 'A task is already in progress. Please wait for it to complete.',
        agent: this.agentType,
      } as OrchestratorUpdate);
      return;
    }

    this.isProcessing = true;

    try {
      const context = this.intentParser.parseRepoContext(instruction);
      if (context) {
        this.intentParser.applyContext(context);

        if (context.action === 'switch' || context.action === 'create') {
          const repoName = this.sessionManager.getFullRepoName() || context.repo;
          this.emit('update', {
            type: 'STATUS_UPDATE',
            userId,
            message: `📁 Working in repository: ${repoName}${context.branch ? ` (branch: ${context.branch})` : ''}`,
            agent: this.agentType,
          } as OrchestratorUpdate);
        }
      }

      const taskDescription = this.extractTaskDescription(instruction);
      this.sessionManager.startTask(taskDescription, userId, this.agentType);

      this.emit('update', {
        type: 'STATUS_UPDATE',
        userId,
        message: `🚀 Starting with ChatGPT Codex: ${taskDescription}`,
        agent: this.agentType,
      } as OrchestratorUpdate);

      const contextPrompt = this.intentParser.buildContextPrompt();
      const fullPrompt = contextPrompt + instruction;

      this.conversationHistory.push({
        role: 'user',
        content: fullPrompt,
      });

      await this.executeWithOpenAI(fullPrompt, userId);
    } catch (error) {
      console.error('Error processing instruction with Codex:', error);
      this.sessionManager.failTask();

      this.emit('update', {
        type: 'ERROR',
        userId,
        message: `Failed to process instruction: ${error instanceof Error ? error.message : String(error)}`,
        agent: this.agentType,
      } as OrchestratorUpdate);
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeWithOpenAI(prompt: string, userId: string): Promise<void> {
    try {
      const messages = [
        {
          role: 'system' as const,
          content:
            'You are ChatGPT Codex, an expert coding assistant. Provide concrete plans and code snippets. ' +
            'When suggesting shell commands, use fenced code blocks. Keep responses concise and actionable.',
        },
        ...this.conversationHistory.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: 'user' as const, content: prompt },
      ];

      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.2,
        messages,
      });

      const content = completion.choices[0]?.message?.content ?? '';

      const detections = this.approvalDetector.detectInResponse(content);

      for (const detection of detections) {
        const repoContext = this.sessionManager.getFullRepoName() || 'current directory';
        const approved = await this.approvalGate.requestApproval(
          userId,
          detection,
          repoContext,
          this.agentType
        );

        if (!approved) {
          this.emit('update', {
            type: 'STATUS_UPDATE',
            userId,
            message: `⛔ Action rejected: ${detection.action}`,
            agent: this.agentType,
          } as OrchestratorUpdate);
        } else {
          this.emit('update', {
            type: 'STATUS_UPDATE',
            userId,
            message: `✅ Action approved: ${detection.action}`,
            agent: this.agentType,
          } as OrchestratorUpdate);
        }
      }

      if (content) {
        this.conversationHistory.push({
          role: 'assistant',
          content,
        });
      }

      this.sessionManager.completeTask();

      const summary = this.summarizeResponse(content);
      this.emit('update', {
        type: 'TASK_COMPLETE',
        userId,
        message: summary,
        agent: this.agentType,
      } as OrchestratorUpdate);
    } catch (error) {
      console.error('OpenAI request failed:', error);
      this.sessionManager.failTask();

      this.emit('update', {
        type: 'ERROR',
        userId,
        message: `Codex failed: ${error instanceof Error ? error.message : String(error)}`,
        agent: this.agentType,
      } as OrchestratorUpdate);
    }
  }

  private extractTaskDescription(instruction: string): string {
    const task = this.intentParser.extractTask(instruction);

    const firstSentence = task.split(/[.!?]/)[0];
    if (firstSentence.length <= 100) {
      return firstSentence.trim();
    }
    return task.substring(0, 97).trim() + '...';
  }

  private summarizeResponse(response: string): string {
    const lines = response.split('\n').filter((l) => l.trim());

    const successIndicators = [
      'created', 'added', 'updated', 'committed', 'pushed',
      'installed', 'completed', 'done', 'success', 'finished'
    ];

    const relevantLines: string[] = [];

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (successIndicators.some((ind) => lower.includes(ind))) {
        relevantLines.push(line);
      }
    }

    if (relevantLines.length > 0) {
      return relevantLines.slice(0, 3).join('\n');
    }

    if (lines.length > 0) {
      return lines.slice(-3).join('\n');
    }

    return 'Task completed successfully.';
  }
}
