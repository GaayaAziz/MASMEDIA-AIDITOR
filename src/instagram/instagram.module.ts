import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { InstagramAuthController } from '../instagram-auth/instagram-auth.controller';
import { InstagramPublishingController } from '../instagram-publishing/instagram-publishing.controller';
import { InstagramCredentialsService } from '../instagram-credentials/instagram-credentials.service';
import { InstagramPublishingService } from '../instagram-publishing/instagram-publishing.service';
import { InstagramCredentials, InstagramCredentialsSchema } from './entities/instagram-credentials.entity';
import { PostsModule } from '../posts/posts.module';
import { HotMomentModule } from '../hot-moment/hot-moment.module'; // ✅ needed if controller uses HotMomentService

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: InstagramCredentials.name, schema: InstagramCredentialsSchema }
    ]),
    HttpModule,
    PostsModule,
    HotMomentModule, // ✅ provides HotMomentService to this module
  ],
  controllers: [
    InstagramAuthController,
    InstagramPublishingController,
  ],
  providers: [
    InstagramCredentialsService,
    InstagramPublishingService,
  ],
  exports: [
    InstagramCredentialsService,
    InstagramPublishingService,
  ],
})
export class InstagramModule {}
