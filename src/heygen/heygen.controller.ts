import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  ValidationPipe,
  Res ,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Express } from 'express';
import { HeygenService } from './heygen.service';
import type { Request,Response } from 'express';

import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ElevenLabsService } from 'src/elevenlabs/elevenlabs.service';
@ApiTags('heygen')
@Controller('heygen')
export class HeygenController {
  constructor(private readonly svc: HeygenService,
        private readonly eleven: ElevenLabsService, // <-- inject EL service

  ) {

  }



  // 1) Upload image → talking_photo_id
  @Post('talking-photo')
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  async uploadTalkingPhoto(@UploadedFile() image: Express.Multer.File) {
    if (!image) throw new BadRequestException('Send form-data: image=<portrait>');
    return this.svc.uploadTalkingPhoto(image);
  }

  // 2) Upload audio → asset_id (if not using public URL)
  @Post('audio-asset')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }))
  async uploadAudio(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Send form-data: file=<mp3/wav>');
    return this.svc.uploadAudioAsset(file);
  }

  // 3) Generate video
  @Post('generate-talking-photo')
  async generateTP(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    body: {
      talkingPhotoId: string;
      audioAssetId?: string;
      audioUrl?: string;
      width?: number;
      height?: number;
      background?: { type: 'color'; value: string } | { type: 'image'; url: string };
    },
  ) {
    if (!body?.talkingPhotoId) throw new BadRequestException('talkingPhotoId is required');
    if (!body.audioAssetId && !body.audioUrl) {
      throw new BadRequestException('Provide audioAssetId or audioUrl');
    }
    return this.svc.generateFromTalkingPhoto(body);
  }

  
  // 4) Poll status


  @Get('status')
  async status(@Query('videoId') videoId: string) {
    if (!videoId) throw new BadRequestException('videoId is required') ;
    return this.svc.getVideoStatus(videoId) ;
  }

  @Get('download')
  async download(@Query('videoId') videoId: string, @Res() res: Response) {
  if (!videoId) return res.status(400).json({ ok: false, error: 'videoId is required' });

  const status = await this.svc.getVideoStatus(videoId);
  const s = status?.data?.status;
  const url = status?.data?.video_url;

  if (s !== 'completed' || !url) {
    return res.status(409).json({ ok: false, status: s || 'unknown', message: 'video not ready yet' });
  }

  await this.svc.streamVideoToResponse(url, res);
  }


@Post('talking-photo-from-text')
@UseInterceptors(
  FileInterceptor('image', {
    storage: memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
  }),
)
async talkingPhotoFromText(
  @UploadedFile() image: Express.Multer.File,
  @Body(new ValidationPipe({ transform: true }))
  body: {
    voiceId: string;
    text: string;
    modelId?: string;
    width?: number;
    height?: number;
    backgroundType?: 'color' | 'image';
    backgroundValue?: string; // '#000000' or 'https://...'
    // NEW (optional) controls:
    pollEveryMs?: number;     // default 4000
    maxWaitMs?: number;       // default 4 hours
        voiceSettings?: { stability?: number; similarityBoost?: number; style?: number; useSpeakerBoost?: boolean }; // <-- add this

  },
  @Res() res: Response,
  @Req() req: Request,
) {
  if (!image) throw new BadRequestException('Send form-data: image=<portrait>');
  if (!body?.voiceId) throw new BadRequestException('voiceId is required');
  if (!body?.text) throw new BadRequestException('text is required');

  const pollEveryMs = Number(body.pollEveryMs ?? 4000);
  const maxWaitMs   = Number(body.maxWaitMs   ?? 4 * 60 * 60 * 1000); // 4 hours
  let aborted = false;
  const onClose = () => { aborted = true; };
  req.on('close', onClose);

  try {
    // 1) ElevenLabs TTS -> MP3 buffer
    const mp3 = await this.eleven.synthesize({
      voiceId: body.voiceId,
      text: body.text,
      modelId: body.modelId ?? 'eleven_multilingual_v2', // optional; your service has a default
      voiceSettings: body.voiceSettings ?? {
        stability: 0.5,
        similarityBoost: 0.82,
        useSpeakerBoost: true,
      },
    });

    // 2) Upload talking photo -> talking_photo_id
    const tp = await this.svc.uploadTalkingPhoto(image);
    const talkingPhotoId = tp?.data?.talking_photo_id ?? tp?.talking_photo_id ?? null;
    if (!talkingPhotoId) throw new BadRequestException('Failed to obtain talking_photo_id');

    // 3) Upload audio buffer (using your union method) -> asset_id (normalized in service)
    const aud = await this.svc.uploadAudioAsset({
      buffer: mp3,
      mimetype: 'audio/mpeg',
      originalname: 'speech.mp3',
    });
    const audioAssetId = aud.asset_id;
    if (!audioAssetId) throw new BadRequestException('Failed to obtain audio asset_id');

    // optional background
    let background: any = undefined;
    if (body.backgroundType && body.backgroundValue) {
      background = body.backgroundType === 'color'
        ? { type: 'color', value: body.backgroundValue }
        : { type: 'image', url: body.backgroundValue };
    }

    // 4) Generate video -> video_id
    const gen = await this.svc.generateFromTalkingPhoto({
      talkingPhotoId,
      audioAssetId,
      width: body.width,
      height: body.height,
      background,
    });
    const videoId = gen?.data?.video_id ?? gen?.video_id ?? null;
    if (!videoId) return res.status(500).json({ ok: false, error: 'video_id missing' });

    // 5) Poll until completed (or timeout), then stream MP4
    const startedAt = Date.now();
    while (!aborted && Date.now() - startedAt < maxWaitMs) {
      const status = await this.svc.getVideoStatus(videoId);
      const s = status?.data?.status;
      const url = status?.data?.video_url;

      if (s === 'completed' && url) {
        // stream and end the request
        await this.svc.streamVideoToResponse(url, res);
        return;
      }
      if (s === 'failed' || status?.data?.error) {
        return res.status(502).json({
          ok: false,
          video_id: videoId,
          status: s,
          error: status?.data?.error || 'generation failed',
        });
      }
      await sleep(pollEveryMs);
    }

    if (aborted) {
      // client disconnected; just stop without writing to res
      return;
    }

    // 6) Timed out on our side—return 202 + ids so client can poll later
    return res.status(202).json({
      ok: false,
      message: 'still processing, try later',
      video_id: videoId,
      talking_photo_id: talkingPhotoId,
      audio_asset_id: audioAssetId,
      pollEveryMs,
      maxWaitMs,
    });
  } finally {
    req.off('close', onClose);
  }
}
  
}
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
