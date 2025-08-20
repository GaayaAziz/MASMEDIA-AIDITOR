import { Injectable } from '@nestjs/common';
import { exec, spawn } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';
import axios from 'axios';

import { HotMomentService } from 'src/hot-moment/hot-moment.service';

dotenv.config();
const CAPTURES_ROOT = path.join(process.cwd(), 'captures');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3001'; 

function toPublicUrl(absPath: string) {
  const rel = path
    .relative(CAPTURES_ROOT, absPath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/');
  return `${PUBLIC_BASE_URL}/media/${rel}`;
}
@Injectable()
export class TranscriptionService {
  private readonly baseUrl = 'https://api.assemblyai.com';
  private readonly headers = {
    authorization: process.env.ASSEMBLYAI_API_KEY,
  };

  constructor(
    private readonly hotMomentService: HotMomentService,
  ) {}

  
  async transcribeLocalAudio(filePath: string): Promise<string> {
    const audioData = await fs.readFile(path.resolve(filePath));
    const uploadRes = await axios.post(
      `${this.baseUrl}/v2/upload`,
      audioData,
      {
        headers: {
          authorization: this.headers.authorization,
          'Content-Type': 'application/octet-stream',
        }
      }
    );

    const uploadUrl = uploadRes.data.upload_url;

    const transcriptRes = await axios.post(
      `${this.baseUrl}/v2/transcript`,
      { audio_url: uploadUrl, language_code: 'en' },
      { headers: this.headers },
    );

    const transcriptId = transcriptRes.data.id;
    const pollingUrl = `${this.baseUrl}/v2/transcript/${transcriptId}`;

    while (true) {
      const poll = await axios.get(pollingUrl, { headers: this.headers });
      if (poll.data.status === 'completed') return poll.data.text;
      if (poll.data.status === 'error') throw new Error(`Transcription error: ${poll.data.error}`);
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  async captureMediaForHotMoment(
    threadId: string,
    title: string,
    liveUrl: string,
  ) {
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const outputDir = path.join(CAPTURES_ROOT, threadId);
    await fs.mkdir(outputDir, { recursive: true });

    const offsets = [75, 60, 45];
    const captures = [];

    for (const offset of offsets) {
      const timestamp = Date.now();
      const screenshotPath = path.join(outputDir, `${timestamp}_${safeTitle}_${offset}s.jpg`);
      const gifPath = path.join(outputDir, `${timestamp}_${safeTitle}_${offset}s.gif`);

      const screenshotCmd = `streamlink --stdout "${liveUrl}" best | ffmpeg -y -ss ${offset} -i - -frames:v 1 -q:v 2 "${screenshotPath}"`;
      const gifCmd = `streamlink --stdout "${liveUrl}" best | ffmpeg -y -ss ${offset} -i - -t 4 -vf "fps=10,scale=480:-1:flags=lanczos" "${gifPath}"`;

      console.log(`📸 Capture à ${offset}s pour thread ${threadId}`);

      await new Promise<void>((resolve, reject) => {
        exec(screenshotCmd, (err) => {
          if (err) {
            console.error(`Erreur screenshot à ${offset}s :`, err);
            return reject(err);
          }
          resolve();
        });
      });

      await new Promise<void>((resolve, reject) => {
        exec(gifCmd, (err) => {
          if (err) {
            console.error(`Erreur gif à ${offset}s :`, err);
            return reject(err);
          }
          resolve();
        });
      });

      const screenshotUrl = toPublicUrl(screenshotPath);
      const gifUrl = toPublicUrl(gifPath);
      captures.push({ offset, screenshotPath, gifPath, screenshotUrl, gifUrl });
    }

    console.log(`✅ Captures terminées pour thread ${threadId}`, captures);
    return captures;
  }

  async transcribeFromLiveStream(liveUrl: string): Promise<void> {
    const outputDir = path.resolve('./segments');
    await fs.ensureDir(outputDir);
    await fs.emptyDir(outputDir);

    console.log('🎬 Starting live stream recording...');

    const threadId = await this.hotMomentService.createThread();
console.log(`🧠 threadID: ${threadId}...`);
    // Store pending captures here:
    const pendingCaptures: Record<string, { offset: number; screenshotPath: string; gifPath: string }[]> = {};

    spawn('streamlink', [
      liveUrl, 'best', '--stdout'
    ]).stdout.pipe(spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-f', 'segment',
      '-segment_time', '60',
      '-c:a', 'libmp3lame',
      '-ar', '16000',
      '-ac', '1',
      '-b:a', '64k',
      `${outputDir}/segment_%03d.mp3`
    ]).stdin);

    const processingFiles = new Set<string>();

    fs.watch(outputDir, async (eventType, filename) => {
      if (filename && filename.endsWith('.mp3')) {
        if (processingFiles.has(filename)) return;
        processingFiles.add(filename);

        const segmentPath = path.join(outputDir, filename);
        try {
          console.log(`🧠 Transcribing ${filename}...`);
          const text = await this.transcribeLocalAudio(segmentPath);
          console.log(`✅ Transcript: ${text}`);

          if (text.trim()) {
            const result = await this.hotMomentService.analyzeParagraph(threadId, text);
            console.log(`🔥 Analyse result:`, result);

            if (result.is_hot_moment && !result.continuation) {
              const captures = await this.captureMediaForHotMoment(threadId, result.moment_title, liveUrl);
              // 🟡 Inject captures into service's temporary store
              (this.hotMomentService as any).pendingCaptures ??= {};
              (this.hotMomentService as any).pendingCaptures[threadId] = captures;
            }
          }

          await fs.promises.unlink(segmentPath);

        } catch (err) {
          
        } finally {
          processingFiles.delete(filename);
        }
      }
    });
  }
}
