import type { ApprovalPatterns } from '../types.js';

export interface DetectedApproval {
  category: 'git' | 'github' | 'npm' | 'deploy';
  action: string;
  command: string;
  isSensitive: boolean;
  details: string;
}

const APPROVAL_PATTERNS: ApprovalPatterns = {
  git: [
    /git\s+push(?:\s|$)/i,
    /git\s+push\s+.*--force/i,
    /git\s+merge(?:\s|$)/i,
    /git\s+branch\s+-[dD].*origin/i,
    /git\s+push\s+.*:.*(?:main|master)/i,
  ],
  github: [
    /gh\s+pr\s+merge/i,
    /gh\s+pr\s+create/i,
    /gh\s+release/i,
  ],
  npm: [
    /npm\s+publish/i,
    /yarn\s+publish/i,
    /pnpm\s+publish/i,
  ],
  deploy: [
    // Only match deploy as a command, not in descriptions
    /^deploy\s+/i,                    // "deploy to production"
    /npm\s+run\s+deploy/i,            // npm run deploy
    /yarn\s+deploy/i,                 // yarn deploy
    /pnpm\s+deploy/i,                 // pnpm deploy
    /\bshipit\b/i,
    /kubectl\s+apply/i,
    /docker\s+push/i,
    /terraform\s+apply/i,
    /vercel\s+(?:deploy|--prod)/i,    // vercel deploy
    /netlify\s+deploy/i,              // netlify deploy
    /firebase\s+deploy/i,             // firebase deploy
    /fly\s+deploy/i,                  // fly deploy
    /railway\s+up/i,                  // railway up
  ],
};

export class ApprovalDetector {
  /**
   * Detect if a command requires approval
   */
  detect(command: string): DetectedApproval | null {
    for (const [category, patterns] of Object.entries(APPROVAL_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(command)) {
          return this.buildApprovalInfo(
            category as keyof ApprovalPatterns,
            command,
            pattern
          );
        }
      }
    }
    return null;
  }

  /**
   * Detect approvals in Claude Code's response text
   * Deduplicates by action to avoid multiple approval requests for the same action type
   */
  detectInResponse(response: string): DetectedApproval[] {
    const detections: DetectedApproval[] = [];
    const seenActions = new Set<string>();
    const lines = response.split('\n');

    for (const line of lines) {
      // Look for command-like patterns
      const trimmed = line.trim();

      // Skip if it's a comment or description
      if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
        continue;
      }

      // Skip markdown formatting and descriptions (not actual commands)
      if (trimmed.startsWith('*') || trimmed.startsWith('-') || trimmed.startsWith('>')) {
        continue;
      }

      // Skip numbered lists (1. 2. etc.)
      if (/^\d+\./.test(trimmed)) {
        continue;
      }

      // Skip lines that look like file paths or descriptions rather than commands
      if (trimmed.includes('.yml') || trimmed.includes('.yaml') || trimmed.includes('.json')) {
        // Only allow if it looks like an actual command (starts with a command word)
        if (!this.looksLikeCommand(trimmed)) {
          continue;
        }
      }

      const detection = this.detect(trimmed);
      if (detection) {
        // Deduplicate by action - only keep one per action type
        const actionKey = `${detection.category}:${detection.action}`;
        if (!seenActions.has(actionKey)) {
          seenActions.add(actionKey);
          detections.push(detection);
        }
      }
    }

    return detections;
  }

  /**
   * Check if a line looks like an actual command rather than a description
   */
  private looksLikeCommand(line: string): boolean {
    const lower = line.toLowerCase();
    // Common command prefixes
    const commandPatterns = [
      /^git\s+/,
      /^gh\s+/,
      /^npm\s+/,
      /^yarn\s+/,
      /^pnpm\s+/,
      /^kubectl\s+/,
      /^docker\s+/,
      /^terraform\s+/,
      /^deploy\s+/,
      /^\$\s*/,  // Shell prompt
      /^>\s*/,   // PowerShell prompt
    ];
    return commandPatterns.some(p => p.test(lower));
  }

  private buildApprovalInfo(
    category: keyof ApprovalPatterns,
    command: string,
    matchedPattern: RegExp
  ): DetectedApproval {
    const actionDescriptions: Record<keyof ApprovalPatterns, Record<string, string>> = {
      git: {
        'push': 'Push to remote repository',
        'push.*--force': 'Force push (destructive)',
        'merge': 'Merge branches',
        'branch.*-[dD]': 'Delete remote branch',
      },
      github: {
        'pr.*merge': 'Merge pull request',
        'pr.*create': 'Create pull request',
        'release': 'Create GitHub release',
      },
      npm: {
        'publish': 'Publish package to npm',
      },
      deploy: {
        'deploy': 'Deploy to environment',
        'kubectl.*apply': 'Apply Kubernetes configuration',
        'docker.*push': 'Push Docker image',
        'terraform.*apply': 'Apply Terraform changes',
        'vercel': 'Deploy to Vercel',
        'netlify': 'Deploy to Netlify',
        'firebase': 'Deploy to Firebase',
        'fly': 'Deploy to Fly.io',
        'railway': 'Deploy to Railway',
      },
    };

    // Find the best action description
    let action = 'Execute sensitive command';
    const categoryDescriptions = actionDescriptions[category];
    for (const [key, desc] of Object.entries(categoryDescriptions)) {
      if (new RegExp(key, 'i').test(command)) {
        action = desc;
        break;
      }
    }

    // Determine sensitivity level
    const isSensitive = this.isSensitiveCommand(command);

    return {
      category,
      action,
      command,
      isSensitive,
      details: this.extractDetails(command),
    };
  }

  private isSensitiveCommand(command: string): boolean {
    // These are extra-sensitive and always require approval
    const highSensitivityPatterns = [
      /--force/i,
      /--hard/i,
      /:.*(?:main|master)/i, // Push to main/master
      /npm\s+publish/i,
      /terraform\s+apply/i,
    ];

    return highSensitivityPatterns.some((p) => p.test(command));
  }

  private extractDetails(command: string): string {
    // Extract useful details from the command
    const parts: string[] = [];

    // Branch info
    const branchMatch = command.match(/origin\s+(\S+)/);
    if (branchMatch) {
      parts.push(`Branch: ${branchMatch[1]}`);
    }

    // Force flag
    if (/--force/i.test(command)) {
      parts.push('⚠️ Force flag enabled');
    }

    // Target info for deployments
    const targetMatch = command.match(/(?:--target|--env|-e)\s+(\S+)/i);
    if (targetMatch) {
      parts.push(`Target: ${targetMatch[1]}`);
    }

    return parts.length > 0 ? parts.join(', ') : command;
  }
}
