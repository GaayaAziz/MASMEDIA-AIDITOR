import { Controller, Get, Query, Param, Put, Body, Delete, HttpException, HttpStatus } from '@nestjs/common';
import { PostsService } from './posts.service';

@Controller('posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  async getAll(@Query('limit') limit = 50) {
    return this.postsService.getAllPosts(+limit);
  }

  @Get('recent')
  async getRecent(@Query('hours') hours = 24, @Query('limit') limit = 50) {
    return this.postsService.getRecentPosts(+hours, +limit);
  }

  @Get('search')
  async search(@Query('q') query: string, @Query('limit') limit = 20) {
    if (!query) {
      throw new HttpException('Search query is required', HttpStatus.BAD_REQUEST);
    }
    return this.postsService.searchPosts(query, +limit);
  }

  @Get('grouped')
  async getGrouped() {
    return this.postsService.getPostsGroupedByPlatform();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const post = await this.postsService.getPostById(id);
    if (!post) {
      throw new HttpException('Post not found', HttpStatus.NOT_FOUND);
    }
    return post;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updates: any) {
    const post = await this.postsService.updatePost(id, updates);
    if (!post) {
      throw new HttpException('Post not found', HttpStatus.NOT_FOUND);
    }
    return post;
  }

  @Put(':id/mark-published')
  async markAsPublished(
    @Param('id') id: string,
    @Body() body: { platform: 'facebook' | 'twitter' | 'instagram'; publishedId?: string }
  ) {
    if (!body.platform) {
      throw new HttpException('Platform is required', HttpStatus.BAD_REQUEST);
    }

    const post = await this.postsService.markAsPublished(id, body.platform, body.publishedId);
    if (!post) {
      throw new HttpException('Post not found', HttpStatus.NOT_FOUND);
    }
    return post;
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    const result = await this.postsService.deletePost(id);
    if (!result) {
      throw new HttpException('Post not found', HttpStatus.NOT_FOUND);
    }
    return { success: true, message: 'Post deleted successfully' };
  }
}