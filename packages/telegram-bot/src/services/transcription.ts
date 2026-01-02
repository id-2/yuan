import OpenAI from 'openai';
import { Readable } from 'stream';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

export class TranscriptionService {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  async transcribe(audioBuffer: Buffer, format: 'ogg' | 'mp3' = 'ogg'): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Create a File object from the buffer
        const file = new File(
          [audioBuffer],
          `audio.${format}`,
          { type: format === 'ogg' ? 'audio/ogg' : 'audio/mpeg' }
        );

        const response = await this.openai.audio.transcriptions.create({
          file,
          model: 'whisper-1',
          response_format: 'text',
        });

        return response;
      } catch (error) {
        lastError = error as Error;
        console.error(`Transcription attempt ${attempt + 1} failed:`, error);

        if (attempt < MAX_RETRIES) {
          await this.delay(RETRY_DELAY_MS * (attempt + 1));
        }
      }
    }

    throw new Error(`Transcription failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
