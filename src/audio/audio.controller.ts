// src/audio/audio.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { AudioCleanerService } from './audio-cleaning.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
@ApiTags('audio')
@Controller('audio')
export class AudioController {
  constructor(private readonly audioService: AudioCleanerService) {}

  @Get('clean')
  async cleanAudio(@Query('url') url: string) {
    const cleanedPath = await this.audioService.cleanAudioFromYoutube(url);
    return { message: 'Audio cleaned successfully', path: cleanedPath };
  }
}
