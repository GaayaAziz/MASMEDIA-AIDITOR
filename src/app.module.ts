import { Module , MiddlewareConsumer, NestModule} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotMomentModule } from './hot-moment/hot-moment.module';
import { AuthModule } from './auth/auth.module';
import * as dotenv from 'dotenv';
import { TranscriptionModule } from './transcription/transcription.module';
import { AudioModule } from './audio/audio.module';
import { TwitterModule } from './twitter/twitter.module';
import { ElevenLabsModule } from './elevenlabs/elevenlabs.module';
import { HeygenModule } from './heygen/heygen.module';

import { LlmScraperModule } from './llm-scraper/llm-scraper.module';
import { PostsModule } from './posts/posts.module';
import { LoggerMiddleware } from './middleware/logger.middleware';
import { FacebookAuthController } from './facebook-publishing/facebook-auth.controller';
import { FacebookPublishingService } from './facebook-publishing/facebook-publishing.service';
import { FacebookPublishingController } from './facebook-publishing/facebook-publishing.controller';
import { FacebookModule } from './facebook-publishing/facebook.module';
import { HttpModule } from '@nestjs/axios'; 
dotenv.config();

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI),
    HotMomentModule,
    TranscriptionModule,
  AudioModule,
  AuthModule,
    ElevenLabsModule,
    TwitterModule,
    HeygenModule,
    PostsModule,
    LlmScraperModule,
    FacebookModule,
    HttpModule, 
    


  ],
  providers: [FacebookPublishingService],
  controllers: [FacebookAuthController, FacebookPublishingController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*'); 
  }
}
