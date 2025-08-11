import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotMomentModule } from './hot-moment/hot-moment.module';
import * as dotenv from 'dotenv';
import { TranscriptionModule } from './transcription/transcription.module';
import { AudioModule } from './audio/audio.module';
import { TwitterModule } from './twitter/twitter.module';
import { ElevenLabsModule } from './elevenlabs/elevenlabs.module';
import { HeygenModule } from './heygen/heygen.module';


dotenv.config();

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI),
    HotMomentModule,
    TranscriptionModule,
    AudioModule,
    ElevenLabsModule,
    TwitterModule,
    HeygenModule,
  ],
  providers: [],
})
export class AppModule {}
