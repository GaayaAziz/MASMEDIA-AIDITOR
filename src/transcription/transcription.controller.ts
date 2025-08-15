// src/transcription/transcription.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { TranscriptionService } from './transcription.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
@ApiTags('transcription')
@Controller('transcription')
export class TranscriptionController {
  constructor(private readonly transcriptionService: TranscriptionService) {}

  //Endpoint existant pour un fichier local
  @Get()
  async transcribe(@Query('file') file: string) {
    const text = await this.transcriptionService.transcribeLocalAudio(file);
    return { transcript: text };
  }

  //Nouveau endpoint pour un livestream
  @Get('live')
  async transcribeLive(@Query('url') liveUrl: string) {
    if (!liveUrl) {
      return { error: 'Missing livestream URL' };
    }

    //Démarre la transcription depuis le live (processus asynchrone)

    this.transcriptionService.transcribeFromLiveStream(liveUrl);

    return {
      message: 'Live transcription started',
      stream: liveUrl,
    };
  }
}
