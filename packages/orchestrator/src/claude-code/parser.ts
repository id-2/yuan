import type { SessionManager } from '../state/session.js';

export interface ParsedContext {
  org?: string;
  repo?: string;
  branch?: string;
  action?: 'switch' | 'create' | 'use_existing';
}

export class IntentParser {
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Parse natural language for repo context changes
   */
  parseRepoContext(instruction: string): ParsedContext | null {
    const lower = instruction.toLowerCase();
    let context: ParsedContext | null = null;

    // Pattern: "create a new repo called X"
    const createRepoMatch = lower.match(
      /create\s+(?:a\s+)?(?:new\s+)?repo(?:sitory)?\s+(?:called\s+|named\s+)?["']?(\S+?)["']?(?:\s|$)/
    );
    if (createRepoMatch) {
      context = {
        repo: createRepoMatch[1],
        action: 'create',
      };
    }

    // Pattern: "go to org X, repo Y" or "switch to org X repo Y"
    const orgRepoMatch = lower.match(
      /(?:go\s+to|switch\s+to|use)\s+(?:the\s+)?org(?:anization)?\s+["']?(\S+?)["']?\s*[,\s]+\s*repo(?:sitory)?\s+["']?(\S+?)["']?(?:\s|$)/
    );
    if (orgRepoMatch) {
      context = {
        org: orgRepoMatch[1],
        repo: orgRepoMatch[2],
        action: 'switch',
      };
    }

    // Pattern: "switch to repo X" or "go to repo X"
    const switchRepoMatch = lower.match(
      /(?:go\s+to|switch\s+to|use|in)\s+(?:the\s+)?(?:repo(?:sitory)?)\s+["']?(\S+?)["']?(?:\s|$)/
    );
    if (switchRepoMatch && !context) {
      const repoName = switchRepoMatch[1];
      // Check if it's org/repo format
      if (repoName.includes('/')) {
        const [org, repo] = repoName.split('/');
        context = { org, repo, action: 'switch' };
      } else {
        context = { repo: repoName, action: 'switch' };
      }
    }

    // Pattern: "on branch X" or "switch to branch X"
    const branchMatch = lower.match(
      /(?:on|switch\s+to|checkout|use)\s+(?:the\s+)?branch\s+["']?(\S+?)["']?(?:\s|$)/
    );
    if (branchMatch) {
      if (context) {
        context.branch = branchMatch[1];
      } else {
        context = { branch: branchMatch[1], action: 'switch' };
      }
    }

    // Pattern: "in the same repo" - use existing context
    if (lower.includes('in the same repo') || lower.includes('same repository')) {
      // Return null to indicate we should keep using existing context
      return null;
    }

    // Pattern: detect repo name in various formats
    // "the yuan repo", "yuan repository"
    const simpleRepoMatch = lower.match(
      /(?:the|in)\s+["']?(\w+)["']?\s+repo(?:sitory)?/
    );
    if (simpleRepoMatch && !context) {
      context = { repo: simpleRepoMatch[1], action: 'switch' };
    }

    return context;
  }

  /**
   * Update session state based on parsed context
   */
  applyContext(context: ParsedContext): void {
    if (context.org !== undefined || context.repo !== undefined) {
      this.sessionManager.setRepoContext(
        context.org ?? this.sessionManager.getRepoContext().org,
        context.repo ?? this.sessionManager.getRepoContext().repo,
        context.branch
      );
    } else if (context.branch) {
      this.sessionManager.setBranch(context.branch);
    }
  }

  /**
   * Extract the actual task from the instruction (removing context-switching phrases)
   */
  extractTask(instruction: string): string {
    // Remove common context-switching phrases
    let task = instruction
      .replace(/(?:go\s+to|switch\s+to|use)\s+(?:the\s+)?org(?:anization)?\s+\S+\s*[,\s]+\s*repo(?:sitory)?\s+\S+\s*/gi, '')
      .replace(/(?:go\s+to|switch\s+to|use|in)\s+(?:the\s+)?(?:repo(?:sitory)?)\s+\S+\s*/gi, '')
      .replace(/(?:on|switch\s+to|checkout|use)\s+(?:the\s+)?branch\s+\S+\s*/gi, '')
      .replace(/in\s+the\s+same\s+repo(?:sitory)?\s*/gi, '')
      .replace(/(?:the|in)\s+\S+\s+repo(?:sitory)?\s*/gi, '')
      .trim();

    // If we removed everything, return the original
    if (!task) {
      task = instruction;
    }

    // Clean up leading conjunctions
    task = task.replace(/^(?:and|then|also|,)\s*/i, '').trim();

    return task;
  }

  /**
   * Build context summary for Claude Code
   */
  buildContextPrompt(): string {
    const ctx = this.sessionManager.getRepoContext();
    const parts: string[] = [];

    if (ctx.org && ctx.repo) {
      parts.push(`Working in repository: ${ctx.org}/${ctx.repo}`);
    } else if (ctx.repo) {
      parts.push(`Working in repository: ${ctx.repo}`);
    }

    if (ctx.branch) {
      parts.push(`On branch: ${ctx.branch}`);
    }

    if (parts.length === 0) {
      return '';
    }

    return `[Context: ${parts.join(', ')}]\n\n`;
  }
}
