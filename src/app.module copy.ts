import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import * as dotenv from 'dotenv';

import { HotMomentModule } from './hot-moment/hot-moment.module';
import { TranscriptionModule } from './transcription/transcription.module';
import { AudioModule } from './audio/audio.module';
import { TwitterModule } from './twitter/twitter.module';
import { ElevenLabsModule } from './elevenlabs/elevenlabs.module';
import { HeygenModule } from './heygen/heygen.module';
import { LlmScraperModule } from './llm-scraper/llm-scraper.module';
import { PostsModule } from './posts/posts.module';

import { FacebookModule } from './facebook-publishing/facebook.module';
import { FacebookAuthController } from './facebook-publishing/facebook-auth.controller';
import { FacebookPublishingController } from './facebook-publishing/facebook-publishing.controller';
import { FacebookPublishingService } from './facebook-publishing/facebook-publishing.service';

import { HttpModule } from '@nestjs/axios';
import { InstagramModule } from './instagram/instagram.module';
import { LoggerMiddleware } from './middleware/logger.middleware';

dotenv.config();

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI),
    HttpModule,

    HotMomentModule,
    TranscriptionModule,
    AudioModule,
    ElevenLabsModule,
    TwitterModule,
    HeygenModule,
    PostsModule,
    LlmScraperModule,

    FacebookModule,
    InstagramModule,    
  ],
  controllers: [
    FacebookAuthController,
    FacebookPublishingController,
  ],
  providers: [
    FacebookPublishingService,

  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
