import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotMomentModule } from './hot-moment/hot-moment.module';
import * as dotenv from 'dotenv';
import { TranscriptionModule } from './transcription/transcription.module';

dotenv.config();

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI),
    HotMomentModule,
    TranscriptionModule,
  ],
  providers: [],
})
export class AppModule {}
