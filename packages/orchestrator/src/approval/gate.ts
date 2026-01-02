import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import type { PendingApproval, OrchestratorUpdate } from '../types.js';
import type { DetectedApproval } from './detector.js';

const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class ApprovalGate extends EventEmitter {
  private pendingApprovals: Map<string, PendingApproval> = new Map();

  /**
   * Request approval for a sensitive action
   * Returns a promise that resolves when approved or rejects when rejected/timed out
   */
  async requestApproval(
    userId: string,
    detection: DetectedApproval,
    repoContext: string
  ): Promise<boolean> {
    const approvalId = uuidv4();

    // Emit update for the bot to send to user
    const update: OrchestratorUpdate = {
      type: 'APPROVAL_REQUIRED',
      userId,
      message: `Approval required for: ${detection.action}`,
      approvalId,
      approvalDetails: {
        action: detection.action,
        repo: repoContext || 'current directory',
        details: detection.details,
      },
    };

    this.emit('update', update);

    return new Promise<boolean>((resolve) => {
      const timeoutId = setTimeout(() => {
        // Auto-reject on timeout
        console.log(`Approval ${approvalId} timed out`);
        this.pendingApprovals.delete(approvalId);

        // Notify user
        this.emit('update', {
          type: 'ERROR',
          userId,
          message: `⏰ Approval request timed out after 30 minutes. Action was not executed.`,
        } as OrchestratorUpdate);

        resolve(false);
      }, APPROVAL_TIMEOUT_MS);

      const pending: PendingApproval = {
        id: approvalId,
        userId,
        action: detection.action,
        repo: repoContext,
        details: detection.details,
        command: detection.command,
        createdAt: new Date(),
        resolve,
        timeoutId,
      };

      this.pendingApprovals.set(approvalId, pending);
    });
  }

  /**
   * Handle approval response from user
   */
  handleResponse(approvalId: string, approved: boolean, userId: string): boolean {
    const pending = this.pendingApprovals.get(approvalId);

    if (!pending) {
      console.warn(`No pending approval found for ID: ${approvalId}`);
      return false;
    }

    // Verify user matches
    if (pending.userId !== userId) {
      console.warn(`User mismatch for approval ${approvalId}: expected ${pending.userId}, got ${userId}`);
      return false;
    }

    // Clear timeout
    clearTimeout(pending.timeoutId);

    // Remove from pending
    this.pendingApprovals.delete(approvalId);

    // Log the decision
    console.log(`Approval ${approvalId}: ${approved ? 'APPROVED' : 'REJECTED'} by user ${userId}`);
    console.log(`Action: ${pending.action}`);
    console.log(`Command: ${pending.command}`);

    // Resolve the promise
    pending.resolve(approved);

    return true;
  }

  /**
   * Get all pending approvals for a user
   */
  getPendingApprovals(userId?: string): PendingApproval[] {
    const approvals = Array.from(this.pendingApprovals.values());
    if (userId) {
      return approvals.filter((a) => a.userId === userId);
    }
    return approvals;
  }

  /**
   * Cancel all pending approvals for a user
   */
  cancelAllForUser(userId: string): void {
    for (const [id, approval] of this.pendingApprovals.entries()) {
      if (approval.userId === userId) {
        clearTimeout(approval.timeoutId);
        approval.resolve(false);
        this.pendingApprovals.delete(id);
      }
    }
  }

  /**
   * Clear all pending approvals
   */
  clearAll(): void {
    for (const approval of this.pendingApprovals.values()) {
      clearTimeout(approval.timeoutId);
      approval.resolve(false);
    }
    this.pendingApprovals.clear();
  }
}
