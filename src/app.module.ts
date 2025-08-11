import { Module , MiddlewareConsumer, NestModule} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotMomentModule } from './hot-moment/hot-moment.module';
import * as dotenv from 'dotenv';
import { TranscriptionModule } from './transcription/transcription.module';
import { AudioModule } from './audio/audio.module';
import { TwitterModule } from './twitter/twitter.module';
import { ElevenLabsModule } from './elevenlabs/elevenlabs.module';
import { HeygenModule } from './heygen/heygen.module';

import { LlmScraperModule } from './llm-scraper/llm-scraper.module';
import { PostsModule } from './posts/posts.module';
import { LoggerMiddleware } from './middleware/logger.middleware';
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
    PostsModule,
    LlmScraperModule,
  ],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*'); // Applique le middleware à toutes les routes
    }
  }