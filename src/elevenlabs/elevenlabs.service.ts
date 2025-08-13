import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CreateSpeechDto } from './dto/create-speech.dto';
import * as FormData from 'form-data';
import { Express } from 'express';
import { CreateVoiceDto } from './dto/create-voice.dto';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class ElevenLabsService {
  private readonly apiKey = process.env.ELEVENLABS_API_KEY!;
  private readonly defaultModelId = process.env.ELEVENLABS_DEFAULT_MODEL_ID || 'eleven_v3';

  // base output dir for saving MP3 chunks
  private readonly baseOutputDir = path.join(process.cwd(), 'chuncks_audio');

  constructor(private readonly http: HttpService) {}

  async synthesize(dto: CreateSpeechDto): Promise<Buffer> {
    const { voiceId, text } = dto;
    const modelId = dto.modelId || this.defaultModelId;

    const voice_settings = dto.voiceSettings
      ? {
          stability: dto.voiceSettings.stability,
          similarity_boost: dto.voiceSettings.similarityBoost,
          style: dto.voiceSettings.style,
          use_speaker_boost: dto.voiceSettings.useSpeakerBoost,
        }
      : undefined;

    try {
      const { data } = await firstValueFrom(
        this.http.post(
          `/v1/text-to-speech/${voiceId}`,
          { text, model_id: modelId, ...(voice_settings ? { voice_settings } : {}) },
          {
            responseType: 'arraybuffer',
            headers: {
              'xi-api-key': this.apiKey,
              'Content-Type': 'application/json',
              Accept: 'audio/mpeg',
            },
            timeout: 60_000,
          },
        ),
      );
      return Buffer.from(data);
    } catch (err: any) {
      const detail =
        err?.response?.data?.toString?.() ||
        err?.response?.data?.error ||
        err?.message ||
        'Unknown';
      throw new InternalServerErrorException(`ElevenLabs TTS failed: ${detail}`);
    }
  }

  async addVoice(dto: CreateVoiceDto, files: Express.Multer.File[]): Promise<{ voice_id: string }> {
    const form = new FormData();
    form.append('name', dto.name);
    if (dto.description) form.append('description', dto.description);
    if (dto.labels) form.append('labels', dto.labels);
    for (const f of files) {
      form.append('files', f.buffer, { filename: f.originalname || 'sample.mp3' });
    }

    try {
      const { data } = await firstValueFrom(
        this.http.post('/v1/voices/add', form, {
          headers: {
            ...form.getHeaders(),
            'xi-api-key': this.apiKey,
          },
          timeout: 60_000,
        }),
      );
      return data; // { voice_id }
    } catch (err: any) {
      const detail = err?.response?.data?.toString?.() || err?.message || 'Unknown';
      throw new InternalServerErrorException(`ElevenLabs add voice failed: ${detail}`);
    }
  }

  // --- helpers système ---
  private spawnAsync(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => (stdout += d.toString()));
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.on('close', (code) => {
        if (code === 0) return resolve(stdout.trim());
        reject(new Error(`${cmd} exited with code ${code}: ${stderr || stdout}`));
      });
    });
  }

  private async ffprobeDuration(filePath: string): Promise<number> {
    const out = await this.spawnAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      filePath,
    ]);
    const sec = parseFloat(out);
    if (!isFinite(sec)) throw new Error('Unable to read duration via ffprobe');
    return sec;
  }

  private async ensureDir(dir: string) {
    await fs.mkdir(dir, { recursive: true });
  }

  // --- découpage en chunks (MP3, no re-encode) ---
  async splitAudioIntoChunks(
    file: Express.Multer.File,
    chunks = 5,
  ): Promise<{ tmpDir: string; parts: string[]; segmentSeconds: number }> {
    if (!file?.buffer?.length) {
      throw new InternalServerErrorException('Uploaded file buffer is empty');
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-'));
    const inputPath = path.join(tmpDir, 'input.mp3'); // keep mp3
    await fs.writeFile(inputPath, file.buffer);

    const duration = await this.ffprobeDuration(inputPath); // seconds
    const segmentSeconds = Math.max(1, Math.floor(duration / Math.max(1, chunks)));

    const outPattern = path.join(tmpDir, 'part_%02d.mp3');
    // -c copy => no re-encode (fast)
    await this.spawnAsync('ffmpeg', [
      '-i',
      inputPath,
      '-f',
      'segment',
      '-segment_time',
      String(segmentSeconds),
      '-c',
      'copy',
      '-map',
      '0:a',
      '-reset_timestamps',
      '1',
      outPattern,
    ]);

    const names = await fs.readdir(tmpDir);
    const parts = names
      .filter((n) => n.startsWith('part_') && n.endsWith('.mp3'))
      .sort()
      .map((n) => path.join(tmpDir, n));

    if (parts.length === 0) {
      throw new InternalServerErrorException('No chunks were produced by ffmpeg');
    }

    return { tmpDir, parts, segmentSeconds };
  }

  /** Persist MP3 chunks to ./chuncks_audio (create folder if missing) */
  async persistChunksToProject(parts: string[]): Promise<{ destDir: string; files: string[] }> {
    await this.ensureDir(this.baseOutputDir);

    const files: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const src = parts[i];
      const dst = path.join(this.baseOutputDir, `part_${String(i).padStart(2, '0')}.mp3`);
      await fs.copyFile(src, dst);
      files.push(dst);
    }
    return { destDir: this.baseOutputDir, files };
  }

  async cleanupDir(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
