import type { Context } from 'grammy';
import type { OrchestratorClient } from '../services/orchestrator.js';

export class CallbackHandler {
  private orchestratorClient: OrchestratorClient;

  constructor(orchestratorClient: OrchestratorClient) {
    this.orchestratorClient = orchestratorClient;
  }

  async handleCallback(ctx: Context): Promise<void> {
    const callbackData = ctx.callbackQuery?.data;
    const userId = ctx.from?.id;

    if (!callbackData || !userId) {
      await ctx.answerCallbackQuery({ text: 'Invalid callback' });
      return;
    }

    console.log(`Received callback from user ${userId}: ${callbackData}`);

    // Parse callback data: "approve:approvalId" or "reject:approvalId"
    const [action, approvalId] = callbackData.split(':');

    if (!action || !approvalId) {
      await ctx.answerCallbackQuery({ text: 'Invalid callback format' });
      return;
    }

    const approved = action === 'approve';

    try {
      await this.orchestratorClient.sendApprovalResponse({
        approvalId,
        approved,
        userId: userId.toString(),
      });

      // Update the message to show the decision
      const statusText = approved ? '✅ Approved' : '❌ Rejected';
      const originalMessage = ctx.callbackQuery?.message;

      if (originalMessage && 'text' in originalMessage) {
        const updatedText = originalMessage.text + `\n\n*Decision: ${statusText}*`;
        await ctx.editMessageText(updatedText, {
          parse_mode: 'Markdown',
        });
      }

      await ctx.answerCallbackQuery({
        text: `${statusText}! Processing...`,
      });
    } catch (error) {
      console.error('Failed to send approval response:', error);
      await ctx.answerCallbackQuery({
        text: '❌ Failed to process approval. Please try again.',
        show_alert: true,
      });
    }
  }
}
