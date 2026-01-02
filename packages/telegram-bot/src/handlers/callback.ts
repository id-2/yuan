import type { Context } from 'grammy';
import type { OrchestratorClient } from '../services/orchestrator.js';

export class CallbackHandler {
  private orchestratorClient: OrchestratorClient;

  constructor(orchestratorClient: OrchestratorClient) {
    this.orchestratorClient = orchestratorClient;
  }

  private async handleQuickAction(action: string, taskId: string | undefined, ctx: Context): Promise<void> {
    const taskLabel = taskId && taskId !== 'unknown' ? ` for task ${taskId}` : '';

    try {
      switch (action) {
        case 'input':
          await ctx.answerCallbackQuery({ text: 'Share more details' });
          await ctx.reply(
            `📝 Please provide additional input${taskLabel}. We'll forward your next message.`,
            {
              reply_markup: { force_reply: true },
            }
          );
          return;
        case 'retry':
          await ctx.answerCallbackQuery({ text: 'Retry requested' });
          await ctx.reply(
            `🔁 Retry selected${taskLabel}. Re-send your last instruction or clarification and I'll forward it.`,
            {
              reply_markup: { force_reply: true },
            }
          );
          return;
        case 'cancel':
          await ctx.answerCallbackQuery({ text: 'Cancel acknowledged' });
          await ctx.reply(
            `✖️ Cancel requested${taskLabel}. Send \"cancel\" to stop the current task.`,
            {
              reply_markup: { force_reply: true },
            }
          );
          return;
        default:
          await ctx.answerCallbackQuery({ text: 'Unknown action', show_alert: true });
      }
    } catch (error) {
      console.error('Failed to process quick action:', error);
      await ctx.answerCallbackQuery({
        text: '❌ Failed to process quick action. Please try again.',
        show_alert: true,
      });
    }
  }

  async handleCallback(ctx: Context): Promise<void> {
    const callbackData = ctx.callbackQuery?.data;
    const userId = ctx.from?.id;

    if (!callbackData || !userId) {
      await ctx.answerCallbackQuery({ text: 'Invalid callback' });
      return;
    }

    console.log(`Received callback from user ${userId}: ${callbackData}`);

    // Parse callback data: "approve:approvalId" or "reject:approvalId" or "quick:action:taskId"
    const [action, target, taskId] = callbackData.split(':');

    if (!action || (!target && action !== 'quick')) {
      await ctx.answerCallbackQuery({ text: 'Invalid callback format' });
      return;
    }

    if (action === 'quick') {
      await this.handleQuickAction(target, taskId, ctx); // target holds quick action
      return;
    }

    const approved = action === 'approve';
    const approvalId = target;

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
