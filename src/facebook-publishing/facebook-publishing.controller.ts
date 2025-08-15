import { Controller, Post, Body, Get, Param, HttpException, HttpStatus, Query } from '@nestjs/common';
import { FacebookPublishingService } from './facebook-publishing.service';
import { FacebookCredentialsService } from './facebook-credentials.service';
import { PostsService } from '../posts/posts.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
@ApiTags('facebook')
@Controller('facebook')
export class FacebookPublishingController {
  constructor(
    private readonly facebookService: FacebookPublishingService,
    private readonly credentialsService: FacebookCredentialsService,
    private readonly postsService: PostsService,
  ) {}

  @Post('publish/:postId')
  async publishPost(
    @Param('postId') postId: string,
    @Body() body: { 
      userId?: string;
      pageId?: string;
      pageAccessToken?: string;
    }
  ) {
    try {
      const post = await this.postsService.getPostById(postId);
      if (!post) {
        throw new HttpException('Post not found', HttpStatus.NOT_FOUND);
      }

      if (post.publishedTo?.facebook?.published) {
        throw new HttpException('Post already published to Facebook', HttpStatus.CONFLICT);
      }

      let credentials;
      if (body.pageId && body.pageAccessToken) {
        credentials = {
          pageId: body.pageId,
          pageAccessToken: body.pageAccessToken,
        };
      } else {
        const storedCredentials = await this.credentialsService.getCredentials(
          body.userId || 'default'
        );
        
        if (!storedCredentials) {
          throw new HttpException(
            'Facebook credentials not found. Please authenticate first.',
            HttpStatus.UNAUTHORIZED
          );
        }
        
        credentials = {
          pageId: storedCredentials.pageId,
          pageAccessToken: storedCredentials.pageAccessToken,
        };
      }

      const isValid = await this.facebookService.validateCredentials(
        credentials.pageId,
        credentials.pageAccessToken
      );

      if (!isValid) {
        throw new HttpException(
          'Invalid Facebook credentials',
          HttpStatus.UNAUTHORIZED
        );
      }

      const result = await this.facebookService.publishToFacebook({
        title: post.title,
        message: post.platforms.facebook,
        imageUrl: post.imageUrl,
        link: post.sourceUrl,
        pageId: credentials.pageId,
        pageAccessToken: credentials.pageAccessToken,
      });

      if (!result.success) {
        throw new HttpException(
          `Failed to publish to Facebook: ${result.error}`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      await this.postsService.markAsPublished(postId, 'facebook', result.postId);

      return {
        success: true,
        message: 'Post published successfully to Facebook',
        facebookPostId: result.postId,
        facebookUrl: `https://www.facebook.com/${result.postId}`,
        originalPost: {
          id: post._id,
          title: post.title,
          sourceName: post.sourceName
        }
      };

    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        `Error publishing to Facebook: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('test-publish')
  async testPublish(@Body() body: {
    message: string;
    imageUrl?: string;
    link?: string;
    userId?: string;
    pageId?: string;
    pageAccessToken?: string;
  }) {
    try {
      if (!body.message) {
        throw new HttpException('Message is required', HttpStatus.BAD_REQUEST);
      }

      let credentials;
      if (body.pageId && body.pageAccessToken) {
        credentials = {
          pageId: body.pageId,
          pageAccessToken: body.pageAccessToken,
        };
      } else {
        const storedCredentials = await this.credentialsService.getCredentials(
          body.userId || 'default'
        );
        
        if (!storedCredentials) {
          throw new HttpException(
            'Facebook credentials not found. Please authenticate first.',
            HttpStatus.UNAUTHORIZED
          );
        }
        
        credentials = {
          pageId: storedCredentials.pageId,
          pageAccessToken: storedCredentials.pageAccessToken,
        };
      }

      const isValid = await this.facebookService.validateCredentials(
        credentials.pageId,
        credentials.pageAccessToken
      );

      if (!isValid) {
        throw new HttpException(
          'Invalid Facebook credentials',
          HttpStatus.UNAUTHORIZED
        );
      }

      const result = await this.facebookService.publishToFacebook({
        title: 'Test Post',
        message: body.message,
        imageUrl: body.imageUrl,
        link: body.link,
        pageId: credentials.pageId,
        pageAccessToken: credentials.pageAccessToken,
      });

      if (!result.success) {
        throw new HttpException(
          `Failed to publish: ${result.error}`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      return {
        success: true,
        message: 'Test post published successfully',
        facebookPostId: result.postId,
        facebookUrl: `https://www.facebook.com/${result.postId}`,
      };

    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        error.message,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('page-info')
  async getPageInfo(@Query('pageId') pageId: string, @Query('pageAccessToken') pageAccessToken: string) {
    try {
      if (!pageId || !pageAccessToken) {
        throw new HttpException(
          'pageId and pageAccessToken query parameters are required',
          HttpStatus.BAD_REQUEST
        );
      }

      const pageInfo = await this.facebookService.getPageInfo(pageId, pageAccessToken);
      
      return {
        success: true,
        pageInfo
      };

    } catch (error) {
      throw new HttpException(
        `Failed to get page info: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('validate-credentials')
  async validateCredentials(@Body() body: { pageId: string; pageAccessToken: string }) {
    try {
      if (!body.pageId || !body.pageAccessToken) {
        throw new HttpException(
          'pageId and pageAccessToken are required',
          HttpStatus.BAD_REQUEST
        );
      }

      const isValid = await this.facebookService.validateCredentials(
        body.pageId,
        body.pageAccessToken
      );

      return {
        success: true,
        valid: isValid,
        message: isValid ? 'Credentials are valid' : 'Credentials are invalid'
      };

    } catch (error) {
      throw new HttpException(
        `Error validating credentials: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('published-posts')
  async getPublishedPosts(@Query('userId') userId: string = 'default') {
    try {
      const allPosts = await this.postsService.getAllPosts(1000);
      const publishedPosts = allPosts.filter(post => post.publishedTo?.facebook?.published);
      
      return {
        success: true,
        count: publishedPosts.length,
        posts: publishedPosts.map(post => ({
          id: post._id,
          title: post.title,
          sourceName: post.sourceName,
          publishedAt: post.publishedTo.facebook.publishedAt,
          facebookPostId: post.publishedTo.facebook.publishedId,
          facebookUrl: post.publishedTo.facebook.publishedId 
            ? `https://www.facebook.com/${post.publishedTo.facebook.publishedId}` 
            : null
        }))
      };
    } catch (error) {
      throw new HttpException(
        `Error fetching published posts: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }}