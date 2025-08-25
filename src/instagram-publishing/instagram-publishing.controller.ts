import { Controller, Post, Body, Get, Param, HttpException, HttpStatus, Query } from '@nestjs/common';
import { InstagramPublishingService } from './instagram-publishing.service';
import { InstagramCredentialsService } from '../instagram-credentials/instagram-credentials.service';
import { PostsService } from '../posts/posts.service';

@Controller('instagram')
export class InstagramPublishingController {
  constructor(
    private readonly instagramService: InstagramPublishingService,
    private readonly credentialsService: InstagramCredentialsService,
    private readonly postsService: PostsService,
  ) {}

  @Post('publish/:postId')
  async publishPost(
    @Param('postId') postId: string,
    @Body() body: {
      userId?: string;
      instagramAccountId?: string;
      accessToken?: string;
      force?: boolean;
    }
  ) {
    try {
      const post = await this.postsService.getPostById(postId);
      if (!post) {
        throw new HttpException('Post not found', HttpStatus.NOT_FOUND);
      }
  
      // Credentials
      let credentials: { instagramAccountId: string; accessToken: string };
      if (body.instagramAccountId && body.accessToken) {
        credentials = {
          instagramAccountId: body.instagramAccountId,
          accessToken: body.accessToken,
        };
      } else {
        const storedCredentials = await this.credentialsService.getCredentials(
          body.userId || 'default'
        );
        if (!storedCredentials) {
          throw new HttpException(
            'Instagram credentials not found. Please authenticate first.',
            HttpStatus.UNAUTHORIZED
          );
        }
        credentials = {
          instagramAccountId: storedCredentials.instagramAccountId,
          accessToken: storedCredentials.instagramAccessToken,
        };
      }
  
      const isValid = await this.instagramService.validateCredentials(
        credentials.instagramAccountId,
        credentials.accessToken
      );
      if (!isValid) {
        throw new HttpException('Invalid Instagram credentials', HttpStatus.UNAUTHORIZED);
      }
  
      // Already published? Verify it still exists remotely
      const prior = post.publishedTo?.instagram;
      if (prior?.published && prior?.publishedId && !body?.force) {
        const stillExists = await this.instagramService.mediaExists(
          prior.publishedId,
          credentials.accessToken
        );
        if (stillExists) {
          throw new HttpException('Post already published to Instagram', HttpStatus.CONFLICT);
        } else {
          await this.postsService.clearPublished(postId, 'instagram');
        }
      }
  
      if (!post.imageUrl) {
        throw new HttpException(
          'Instagram requires an image. This post has no image to publish.',
          HttpStatus.BAD_REQUEST
        );
      }
  
      const caption =
        post.platforms?.instagram ||
        post.platforms?.facebook ||
        post.platforms?.masmedia ||
        post.platforms?.twitter ||
        post.title ||
        'Check out this post!';
  
      const result = await this.instagramService.publishToInstagram({
        caption,
        imageUrl: post.imageUrl,
        instagramAccountId: credentials.instagramAccountId,
        accessToken: credentials.accessToken,
      });
  
      if (!result.success || !result.postId) {
        throw new HttpException(
          `Failed to publish to Instagram: ${result.error}`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
  
      // Get the official permalink (do NOT pass to markAsPublished, your schema has no field)
      const permalink = await this.instagramService.getPermalink(
        result.postId,
        credentials.accessToken
      );
  
      // Save publish state (3-arg signature)
      await this.postsService.markAsPublished(postId, 'instagram', result.postId);
  
      return {
        success: true,
        message: 'Post published successfully to Instagram',
        instagramPostId: result.postId,
        instagramUrl: permalink || null,
        originalPost: {
          id: post._id,
          title: post.title,
          sourceName: post.sourceName,
        },
        note:
          prior?.published && !body?.force
            ? 'The previous Instagram media no longer existed; state was reset and the post was re-published.'
            : undefined,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Error publishing to Instagram: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  
  
  

  @Post('test-publish')
  async testPublish(@Body() body: {
    caption: string;
    imageUrl: string;
    userId?: string;
    instagramAccountId?: string;
    accessToken?: string;
  }) {
    try {
      if (!body.caption) {
        throw new HttpException('Caption is required', HttpStatus.BAD_REQUEST);
      }

      if (!body.imageUrl) {
        throw new HttpException('Image URL is required for Instagram posts', HttpStatus.BAD_REQUEST);
      }

      let credentials;
      if (body.instagramAccountId && body.accessToken) {
        credentials = {
          instagramAccountId: body.instagramAccountId,
          accessToken: body.accessToken,
        };
      } else {
        const storedCredentials = await this.credentialsService.getCredentials(
          body.userId || 'default'
        );
        
        if (!storedCredentials) {
          throw new HttpException(
            'Instagram credentials not found. Please authenticate first.',
            HttpStatus.UNAUTHORIZED
          );
        }
        
        credentials = {
          instagramAccountId: storedCredentials.instagramAccountId,
          accessToken: storedCredentials.instagramAccessToken,
        };
      }

      const isValid = await this.instagramService.validateCredentials(
        credentials.instagramAccountId,
        credentials.accessToken
      );

      if (!isValid) {
        throw new HttpException(
          'Invalid Instagram credentials',
          HttpStatus.UNAUTHORIZED
        );
      }

      const result = await this.instagramService.publishToInstagram({
        caption: body.caption,
        imageUrl: body.imageUrl,
        instagramAccountId: credentials.instagramAccountId,
        accessToken: credentials.accessToken,
      });

      if (!result.success) {
        throw new HttpException(
          `Failed to publish: ${result.error}`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      return {
        success: true,
        message: 'Test post published successfully to Instagram',
        instagramPostId: result.postId,
        instagramUrl: `https://www.instagram.com/p/${result.postId}`,
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

  @Post('publish-carousel')
  async publishCarousel(@Body() body: {
    caption: string;
    imageUrls: string[];
    userId?: string;
    instagramAccountId?: string;
    accessToken?: string;
  }) {
    try {
      if (!body.caption) {
        throw new HttpException('Caption is required', HttpStatus.BAD_REQUEST);
      }

      if (!body.imageUrls || body.imageUrls.length === 0) {
        throw new HttpException('At least one image URL is required for Instagram carousel', HttpStatus.BAD_REQUEST);
      }

      if (body.imageUrls.length > 10) {
        throw new HttpException('Instagram carousel supports maximum 10 images', HttpStatus.BAD_REQUEST);
      }

      let credentials;
      if (body.instagramAccountId && body.accessToken) {
        credentials = {
          instagramAccountId: body.instagramAccountId,
          accessToken: body.accessToken,
        };
      } else {
        const storedCredentials = await this.credentialsService.getCredentials(
          body.userId || 'default'
        );
        
        if (!storedCredentials) {
          throw new HttpException(
            'Instagram credentials not found. Please authenticate first.',
            HttpStatus.UNAUTHORIZED
          );
        }
        
        credentials = {
          instagramAccountId: storedCredentials.instagramAccountId,
          accessToken: storedCredentials.instagramAccessToken,
        };
      }

      const isValid = await this.instagramService.validateCredentials(
        credentials.instagramAccountId,
        credentials.accessToken
      );

      if (!isValid) {
        throw new HttpException(
          'Invalid Instagram credentials',
          HttpStatus.UNAUTHORIZED
        );
      }

      const result = await this.instagramService.publishCarouselToInstagram({
        caption: body.caption,
        imageUrls: body.imageUrls,
        instagramAccountId: credentials.instagramAccountId,
        accessToken: credentials.accessToken,
      });

      if (!result.success) {
        throw new HttpException(
          `Failed to publish carousel: ${result.error}`,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      return {
        success: true,
        message: 'Carousel published successfully to Instagram',
        instagramPostId: result.postId,
        instagramUrl: `https://www.instagram.com/p/${result.postId}`,
        imageCount: body.imageUrls.length,
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

  @Get('account-info')
  async getAccountInfo(
    @Query('instagramAccountId') instagramAccountId: string, 
    @Query('accessToken') accessToken: string
  ) {
    try {
      if (!instagramAccountId || !accessToken) {
        throw new HttpException(
          'instagramAccountId and accessToken query parameters are required',
          HttpStatus.BAD_REQUEST
        );
      }

      const accountInfo = await this.instagramService.getInstagramAccountInfo(
        instagramAccountId, 
        accessToken
      );
      
      return {
        success: true,
        accountInfo
      };

    } catch (error) {
      throw new HttpException(
        `Failed to get Instagram account info: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('validate-credentials')
  async validateCredentials(@Body() body: { instagramAccountId: string; accessToken: string }) {
    try {
      if (!body.instagramAccountId || !body.accessToken) {
        throw new HttpException(
          'instagramAccountId and accessToken are required',
          HttpStatus.BAD_REQUEST
        );
      }

      const isValid = await this.instagramService.validateCredentials(
        body.instagramAccountId,
        body.accessToken
      );

      return {
        success: true,
        valid: isValid,
        message: isValid ? 'Credentials are valid' : 'Credentials are invalid'
      };

    } catch (error) {
      throw new HttpException(
        `Error validating Instagram credentials: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('published-posts')
  async getPublishedPosts(@Query('userId') userId: string = 'default') {
    try {
      const allPosts = await this.postsService.getAllPosts(1000);
      const publishedPosts = allPosts.filter(post => post.publishedTo?.instagram?.published);
      
      return {
        success: true,
        count: publishedPosts.length,
        posts: publishedPosts.map(post => ({
          id: post._id,
          title: post.title,
          sourceName: post.sourceName,
          publishedAt: post.publishedTo?.instagram?.publishedAt,
          instagramPostId: post.publishedTo?.instagram?.publishedId,
          instagramUrl: post.publishedTo?.instagram?.publishedId 
            ? `https://www.instagram.com/p/${post.publishedTo.instagram.publishedId}` 
            : null
        }))
      };
    } catch (error) {
      throw new HttpException(
        `Error fetching published Instagram posts: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('recent-posts')
  async getRecentPosts(
    @Query('userId') userId: string = 'default',
    @Query('limit') limit: string = '10'
  ) {
    try {
      const credentials = await this.credentialsService.getCredentials(userId);
      
      if (!credentials) {
        throw new HttpException(
          'Instagram credentials not found. Please authenticate first.',
          HttpStatus.UNAUTHORIZED
        );
      }

      const posts = await this.instagramService.getRecentPosts(
        credentials.instagramAccountId,
        credentials.instagramAccessToken,
        parseInt(limit)
      );
      
      return {
        success: true,
        count: posts.length,
        posts
      };

    } catch (error) {
      throw new HttpException(
        `Error fetching recent Instagram posts: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('post-insights/:postId')
  async getPostInsights(
    @Param('postId') postId: string,
    @Query('userId') userId: string = 'default'
  ) {
    try {
      const credentials = await this.credentialsService.getCredentials(userId);
      
      if (!credentials) {
        throw new HttpException(
          'Instagram credentials not found. Please authenticate first.',
          HttpStatus.UNAUTHORIZED
        );
      }

      const insights = await this.instagramService.getPostInsights(
        postId,
        credentials.instagramAccessToken
      );
      
      return {
        success: true,
        postId,
        insights
      };

    } catch (error) {
      throw new HttpException(
        `Error fetching Instagram post insights: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}