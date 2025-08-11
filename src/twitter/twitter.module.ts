// twitter.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TwitterService } from './twitter.service';
import { TwitterController } from './twitter.controller';

@Module({
  imports: [ConfigModule], // Make sure ConfigModule is imported to access .env variables
  providers: [TwitterService],
  controllers: [TwitterController],
})
export class TwitterModule {}
