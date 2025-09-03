import { Controller, Post, Body, Get, Param, HttpException, HttpStatus, Query, Logger } from '@nestjs/common';
import { InstagramPublishingService } from './instagram-publishing.service';
import { InstagramCredentialsService } from '../instagram-credentials/instagram-credentials.service';
import { PostsService } from '../posts/posts.service';
import { HotMomentService } from 'src/hot-moment/hot-moment.service';

@Controller('instagram')
export class InstagramPublishingController {
  constructor(
    private readonly instagramService: InstagramPublishingService,
    private readonly credentialsService: InstagramCredentialsService,
    private readonly postsService: PostsService,
    private readonly hotMomentService: HotMomentService,
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

@Post('publish-hot-moment/:hotMomentId')
async publishHotMoment(
  @Param('hotMomentId') hotMomentId: string,
  @Body()
  body: {
    userId?: string;
    instagramAccountId?: string;
    accessToken?: string;
    captureIndex?: number;   // which capture to use (default 0)
    force?: boolean;         // ignore local published state if remote media is gone
    overrideCaption?: string; // optionally override caption
    overrideImage?: string;   // optionally override image (public url or local path)
  }
) {
  try {
    // 1) Load the hot moment
    const moment = await this.hotMomentService.getHotMomentById(hotMomentId);
    if (!moment) {
      throw new HttpException('Hot moment not found', HttpStatus.NOT_FOUND);
    }

    // 2) Resolve credentials
    let credentials: { instagramAccountId: string; accessToken: string };
    if (body.instagramAccountId && body.accessToken) {
      credentials = { instagramAccountId: body.instagramAccountId, accessToken: body.accessToken };
    } else {
      const stored = await this.credentialsService.getCredentials(body.userId || 'default');
      if (!stored) {
        throw new HttpException('Instagram credentials not found. Please authenticate first.', HttpStatus.UNAUTHORIZED);
      }
      credentials = {
        instagramAccountId: stored.instagramAccountId,
        accessToken: stored.instagramAccessToken,
      };
    }

    // 3) Validate credentials
    const ok = await this.instagramService.validateCredentials(credentials.instagramAccountId, credentials.accessToken);
    if (!ok) throw new HttpException('Invalid Instagram credentials', HttpStatus.UNAUTHORIZED);

    // 4) Already published? verify remote existence unless force
    const prior = moment.publishedTo?.instagram;
    if (prior?.published && prior?.publishedId && !body?.force) {
      const exists = await this.instagramService.mediaExists(prior.publishedId, credentials.accessToken);
      if (exists) {
        throw new HttpException('Hot moment already published to Instagram', HttpStatus.CONFLICT);
      } else {
        await this.hotMomentService.clearPublishedHotMoment(hotMomentId, 'instagram');
      }
    }

    // 5) Caption
    const caption =
      body.overrideCaption?.trim() ||
      moment.posts?.instagram?.toString()?.trim() ||
      moment.posts?.facebook?.toString()?.trim() ||
      moment.moment_title ||
      'Check this out!';

    // 6) Choose image - Updated to use URL fields (Instagram requires screenshots, not GIFs)
    let rawImage: string | undefined = body.overrideImage;
    if (!rawImage && Array.isArray(moment.captures) && moment.captures.length > 0) {
      const idx = Math.max(0, Math.min(moment.captures.length - 1, body.captureIndex ?? 0));
      const cap = moment.captures[idx] as { 
        offset: number; 
        screenshotPath: string; 
        gifPath: string;
        screenshotUrl: string;
        gifUrl: string;
      };
      
      // For Instagram, prefer screenshot URL (no GIFs in feed posts)
      rawImage = cap.screenshotUrl || undefined;
    }

    if (!rawImage) {
      throw new HttpException('Instagram requires a still image (screenshot). None found for this hot moment.', HttpStatus.BAD_REQUEST);
    }

    // 7) Check if image is localhost and set useCloudUpload flag
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(rawImage);
    
    // 8) Publish with cloud upload enabled for localhost URLs
    const result = await this.instagramService.publishToInstagram({
      caption,
      imageUrl: rawImage,
      instagramAccountId: credentials.instagramAccountId,
      accessToken: credentials.accessToken,
      useCloudUpload: isLocalhost, // Enable cloud upload for localhost URLs
    });

    if (!result.success || !result.postId) {
      throw new HttpException(`Failed to publish hot moment to Instagram: ${result.error}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // 9) Save state
    await this.hotMomentService.markAsPublishedHotMoment(hotMomentId, 'instagram', result.postId);

    // 10) Permalink
    const permalink = await this.instagramService.getPermalink(result.postId, credentials.accessToken);

    return {
      success: true,
      message: 'Hot moment published to Instagram',
      instagramPostId: result.postId,
      instagramUrl: permalink || null,
      note:
        prior?.published && !body?.force
          ? 'Previous Instagram media no longer existed; state was reset and the hot moment was re-published.'
          : undefined,
    };
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new HttpException(`Error publishing hot moment to Instagram: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
@Get('debug-credentials/:userId')
async debugCredentials(@Param('userId') userId: string) {
  try {
    console.log(`Debug: Fetching credentials for userId: ${userId}`);
    
    const credentials = await this.credentialsService.getCredentials(userId);
    
    if (!credentials) {
      return {
        success: false,
        message: 'No credentials found',
        userId: userId
      };
    }

    // Test the credentials
    const validationResult = await this.instagramService.validateCredentials(
      credentials.instagramAccountId,
      credentials.instagramAccessToken
    );

    // Get account info if validation passes
    let accountInfo = null;
    if (validationResult) {
      try {
        accountInfo = await this.instagramService.getInstagramAccountInfo(
          credentials.instagramAccountId,
          credentials.instagramAccessToken
        );
      } catch (error) {
        console.warn(`Could not fetch account info: ${error.message}`);
      }
    }

    return {
      success: true,
      credentials: {
        userId: credentials.userId,
        instagramAccountId: credentials.instagramAccountId,
        instagramUsername: credentials.instagramUsername,
        instagramName: credentials.instagramName,
        accountType: credentials.accountType,
        isActive: credentials.isActive,
        lastUsedAt: credentials.lastUsedAt,
        failedAttempts: credentials.failedAttempts,
        // Don't expose full token for security, just show first/last chars
        tokenPreview: credentials.instagramAccessToken ? 
          `${credentials.instagramAccessToken.substring(0, 10)}...${credentials.instagramAccessToken.substring(credentials.instagramAccessToken.length - 10)}` : 
          'No token'
      },
      validation: {
        isValid: validationResult,
        accountInfo: accountInfo
      },
      debug: {
        timestamp: new Date().toISOString(),
        nodeEnv: process.env.NODE_ENV
      }
    };

  } catch (error) {
    console.error(`Debug credentials error: ${error.message}`);
    throw new HttpException(
      `Debug error: ${error.message}`,
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
}