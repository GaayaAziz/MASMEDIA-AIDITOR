import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { FacebookAuthController } from './facebook-auth.controller';
import { FacebookPublishingController } from './facebook-publishing.controller';
import { FacebookPublishingService } from './facebook-publishing.service';
import { FacebookCredentialsService } from './facebook-credentials.service';
import { FacebookCredentials, FacebookCredentialsSchema } from './entities/facebook-credentials.entity';
import { PostsModule } from '../posts/posts.module';
import { HotMomentModule } from '../hot-moment/hot-moment.module'; // ✅ import the provider’s module

@Module({
  imports: [
    HttpModule,
    PostsModule,
    HotMomentModule, // ✅ makes HotMomentService available to this module
    MongooseModule.forFeature([
      { name: FacebookCredentials.name, schema: FacebookCredentialsSchema },
    ]),
  ],
  controllers: [FacebookAuthController, FacebookPublishingController],
  providers: [FacebookPublishingService, FacebookCredentialsService],
  exports: [FacebookPublishingService, FacebookCredentialsService],
})
export class FacebookModule {}
