import { Controller, Get, Query } from '@nestjs/common';
import { PostsService } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  async getAll(@Query('limit') limit = 50) {
    return this.postsService.getAllPosts(+limit);
  }

  @Get('grouped')
  async getGrouped() {
    return this.postsService.getPostsGroupedByPlatform();
  }
}
