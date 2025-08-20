import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  ValidationPipe,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ElevenLabsService } from './elevenlabs.service';
import { CreateSpeechDto } from './dto/create-speech.dto';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { CreateVoiceDto } from './dto/create-voice.dto';
import { memoryStorage } from 'multer';
import type { Express } from 'express';
import * as path from 'path';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('elevenlabs')
@Controller('elevenlabs')
export class ElevenLabsController {
  constructor(private readonly service: ElevenLabsService) {}

  @Post('tts')
  async tts(
    @Body(new ValidationPipe({ whitelist: true, transform: true })) dto: CreateSpeechDto,
    @Res() res: Response,
  ) {
    const audio = await this.service.synthesize(dto);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'inline; filename="speech.mp3"');
    res.send(audio);
  }

  @Post('voices')
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      storage: memoryStorage(),
      limits: { fileSize: 200 * 1024 * 1024 },
    }),
  )
  async addVoice(
    @Body(new ValidationPipe({ whitelist: true, transform: true })) dto: CreateVoiceDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one audio file is required under field "files".');
    }
    return this.service.addVoice(dto, files);
  }

  /** Upload file, split to MP3 chunks, save to ./chuncks_audio, return JSON (no ZIP) */
  @Post('split')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 200 * 1024 * 1024 },
    }),
  )
  async split(
    @UploadedFile() file: Express.Multer.File,
    @Body('chunks') chunksRaw: string,
  ) {
    if (!file) throw new BadRequestException('Missing file');

    const chunks = Math.max(1, Math.min(20, Number(chunksRaw) || 5));
    const { tmpDir, parts, segmentSeconds } = await this.service.splitAudioIntoChunks(file, chunks);

    // Save chunks to project folder
    const persisted = await this.service.persistChunksToProject(parts);

    // Cleanup temp dir
    await this.service.cleanupDir(tmpDir);

    const rel = (p: string) =>
      p.replace(process.cwd(), '').replace(/\\/g, '/').replace(/^\/?/, '/');

    return {
      ok: true,
      outputDir: rel(persisted.destDir), // /chuncks_audio
      segmentSeconds,
      files: persisted.files.map(rel),   // /chuncks_audio/part_00.mp3, ...
    };
  }

}
