// post.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { TwitterService } from './twitter.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
@ApiTags('twitter')
@Controller('twitter')
export class TwitterController {
  constructor(private readonly twitterService: TwitterService) {}

  @Post('post')
async tweetWithLocalImage(@Body() body: { text: string; imagePath: string }) {
  return this.twitterService.postTweetWithLocalImage(body.text, body.imagePath);
}

}
