import { Module } from '@nestjs/common';
import { AudioController } from './audio.controller';
import { AudioCleanerService } from './audio-cleaning.service';

@Module({
  controllers: [AudioController],
  providers: [AudioCleanerService],
})
export class AudioModule {}
