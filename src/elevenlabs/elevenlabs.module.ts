import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ElevenLabsService } from './elevenlabs.service';
import { ElevenLabsController } from './elevenlabs.controller';

@Module({
  imports: [
    HttpModule.register({
  baseURL: 'https://api.elevenlabs.io',
  timeout: 60000,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
})
,
  ],
  controllers: [ElevenLabsController],
  providers: [ElevenLabsService],
  exports: [ElevenLabsService],
})
export class ElevenLabsModule {}
