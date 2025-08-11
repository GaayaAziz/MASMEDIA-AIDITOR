import { Module } from '@nestjs/common';
import { LlmScraperService } from './llm-scraper.service';
import { LlmScraperController } from './llm-scraper.controller';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { ScrapeLog, ScrapeLogSchema } from './entities/log.entity';
import { PostsModule } from '../posts/posts.module';

@Module({
  imports: [
    HttpModule,
    PostsModule,
    MongooseModule.forFeature([{ name: ScrapeLog.name, schema: ScrapeLogSchema }])
  ],
  controllers: [LlmScraperController],
  providers: [LlmScraperService],
})
export class LlmScraperModule {}
