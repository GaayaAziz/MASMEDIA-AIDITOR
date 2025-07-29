// src/transcription/transcription.module.ts
import { Module } from '@nestjs/common';
import { TranscriptionService } from './transcription.service';
import { TranscriptionController } from './transcription.controller';
import { HotMomentService } from 'src/hot-moment/hot-moment.service';
import { HotMomentModule } from 'src/hot-moment/hot-moment.module';

@Module({
  imports: [
    HotMomentModule,  // <-- module qui fournit HotMomentService ET HotMomentModel
  ],
  providers: [TranscriptionService],
  controllers: [TranscriptionController],
})
export class TranscriptionModule {}

