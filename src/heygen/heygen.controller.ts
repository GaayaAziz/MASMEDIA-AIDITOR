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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Express } from 'express';
import { HeygenService } from './heygen.service';
import type { Response } from 'express';


@Controller('heygen')
export class HeygenController {
  constructor(private readonly svc: HeygenService) {}

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
    if (!videoId) throw new BadRequestException('videoId is required');
    return this.svc.getVideoStatus(videoId);
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
}
