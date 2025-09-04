import { Controller, Post, Body, Get, Param, HttpException, HttpStatus, Query, Logger } from '@nestjs/common';
import { InstagramPublishingService } from './instagram-publishing.service';
import { InstagramCredentialsService } from '../instagram-credentials/instagram-credentials.service';
import { PostsService } from '../posts/posts.service';
import { HotMomentService } from 'src/hot-moment/hot-moment.service';

@Controller('instagram')
export class InstagramPublishingController {
    private readonly logger = new Logger(InstagramPublishingController.name);

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
    useCloudUpload?: boolean; // Add this parameter
  }
) {
  try {
    const post = await this.postsService.getPostById(postId);
    if (!post) {
      throw new HttpException('Post not found', HttpStatus.NOT_FOUND);
    }

    // Credentials validation (existing code)
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

    // Check existing publication status
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

    // Get caption from platforms object - fix the caption extraction
    const caption = post.platforms?.instagram || 
                   post.platforms?.facebook || 
                   post.platforms?.twitter || 
                   post.title || 
                   'Check out this post!';

    // Check if image is localhost and determine useCloudUpload
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(post.imageUrl);
    
    const result = await this.instagramService.publishToInstagram({
      caption,
      imageUrl: post.imageUrl,
      instagramAccountId: credentials.instagramAccountId,
      accessToken: credentials.accessToken,
      useCloudUpload: body.useCloudUpload || isLocalhost, // Enable cloud upload for localhost or when requested
    });

    if (!result.success || !result.postId) {
      throw new HttpException(
        `Failed to publish to Instagram: ${result.error}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const permalink = await this.instagramService.getPermalink(
      result.postId,
      credentials.accessToken
    );

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
      note: prior?.published && !body?.force
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
  useCloudUpload?: boolean; // Add this parameter
}) {
  try {
    if (!body.caption) {
      throw new HttpException('Caption is required', HttpStatus.BAD_REQUEST);
    }

    if (!body.imageUrl) {
      throw new HttpException('Image URL is required for Instagram posts', HttpStatus.BAD_REQUEST);
    }

    // Validate caption length
    if (body.caption.length > 2200) {
      throw new HttpException('Caption too long. Instagram allows maximum 2200 characters.', HttpStatus.BAD_REQUEST);
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

    // Check if image is localhost and determine useCloudUpload
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(body.imageUrl);

    const result = await this.instagramService.publishToInstagram({
      caption: body.caption,
      imageUrl: body.imageUrl,
      instagramAccountId: credentials.instagramAccountId,
      accessToken: credentials.accessToken,
      useCloudUpload: body.useCloudUpload || isLocalhost, // Enable cloud upload for localhost or when requested
    });

    if (!result.success) {
      throw new HttpException(
        `Failed to publish: ${result.error}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const permalink = await this.instagramService.getPermalink(
      result.postId,
      credentials.accessToken
    );

    return {
      success: true,
      message: 'Test post published successfully to Instagram',
      instagramPostId: result.postId,
      instagramUrl: permalink || `https://www.instagram.com/p/${result.postId}`,
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
    selectedImageIndices?: number[];
    preferGif?: boolean; // This will be ignored for Instagram since GIFs aren't supported
    force?: boolean;
    overrideCaption?: string;
    overrideImages?: string[];
  }
) {
  try {
    // 1) Load the hot moment
    const moment = await this.hotMomentService.getHotMomentById(hotMomentId);
    if (!moment) {
      throw new HttpException('Hot moment not found', HttpStatus.NOT_FOUND);
    }

    this.logger.log(`Publishing hot moment: ${hotMomentId}`);
    this.logger.log(`Available captures: ${moment.captures?.length || 0}`);
    this.logger.log(`Requested indices: ${JSON.stringify(body.selectedImageIndices)}`);

    // 2) Resolve credentials
    let credentials: { instagramAccountId: string; accessToken: string };
    if (body.instagramAccountId && body.accessToken) {
      credentials = { instagramAccountId: body.instagramAccountId, accessToken: body.accessToken };
    } else {
      const stored = await this.credentialsService.getCredentials(body.userId || 'testuser');
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

    // 6) Handle image selection
    let selectedImages: string[] = [];
    
    if (body.overrideImages && body.overrideImages.length > 0) {
      selectedImages = body.overrideImages.slice(0, 10);
      this.logger.log(`Using override images: ${selectedImages.length} images`);
    } else if (Array.isArray(moment.captures) && moment.captures.length > 0) {
      // Validate requested indices against actual array length
      const maxIndex = moment.captures.length - 1;
      const indicesToUse = body.selectedImageIndices && body.selectedImageIndices.length > 0 
        ? body.selectedImageIndices.filter(idx => idx >= 0 && idx <= maxIndex).slice(0, 10)
        : Array.from({length: Math.min(moment.captures.length, 10)}, (_, i) => i);
      
      this.logger.log(`Processing ${indicesToUse.length} valid indices from ${body.selectedImageIndices?.length || 0} requested: ${JSON.stringify(indicesToUse)}`);
      this.logger.log(`Max available index: ${maxIndex}`);
      
      for (const idx of indicesToUse) {
        const cap = moment.captures[idx] as { 
          offset: number; 
          screenshotPath?: string; 
          gifPath?: string;
          screenshotUrl?: string;
          gifUrl?: string;
        };
        
        this.logger.log(`Processing capture ${idx}:`, {
          offset: cap.offset,
          screenshotUrl: cap.screenshotUrl,
          gifUrl: cap.gifUrl // Instagram doesn't support GIFs, but logging for debug
        });
        
        let imageUrl: string | null = null;
        
        // Instagram doesn't support GIFs, always use screenshot
        // Priority: screenshotUrl > constructed URL from screenshotPath
        if (cap.screenshotUrl) {
          imageUrl = cap.screenshotUrl;
          this.logger.log(`Using screenshotUrl for capture ${idx}: ${imageUrl}`);
        } else if (cap.screenshotPath) {
          // Construct URL from path
          const normalizedPath = cap.screenshotPath.replace(/\\/g, '/');
          const pathParts = normalizedPath.split('/');
          const filename = pathParts.pop();
          const threadFolder = pathParts.find(part => part.includes('thread_'));
          
          if (filename && threadFolder) {
            imageUrl = `http://localhost:3001/media/${threadFolder}/${filename}`;
          } else if (filename) {
            imageUrl = `http://localhost:3001/media/${filename}`;
          }
          this.logger.log(`Constructed URL from screenshotPath for capture ${idx}: ${imageUrl}`);
        }
        
        if (imageUrl) {
          selectedImages.push(imageUrl);
          this.logger.log(`Added image ${selectedImages.length}: ${imageUrl}`);
        } else {
          this.logger.warn(`No valid image URL found for capture ${idx}`);
        }
      }
    }

    this.logger.log(`Final selected images: ${selectedImages.length} images`);

    if (selectedImages.length === 0) {
      throw new HttpException(
        'Instagram requires at least one image. No valid images found for this hot moment.',
        HttpStatus.BAD_REQUEST
      );
    }

    // 7) Check if images are localhost and set useCloudUpload flag
    const hasLocalhostImages = selectedImages.some(img => 
      /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(img)
    );

    this.logger.log(`Has localhost images: ${hasLocalhostImages}`);

    // 8) Publish - single image or carousel
    let result;
    if (selectedImages.length === 1) {
      this.logger.log('Publishing single image to Instagram');
      result = await this.instagramService.publishToInstagram({
        caption,
        imageUrl: selectedImages[0],
        instagramAccountId: credentials.instagramAccountId,
        accessToken: credentials.accessToken,
        useCloudUpload: hasLocalhostImages,
      });
    } else {
      this.logger.log(`Publishing carousel with ${selectedImages.length} images to Instagram`);
      result = await this.instagramService.publishCarouselToInstagram({
        caption,
        imageUrls: selectedImages,
        instagramAccountId: credentials.instagramAccountId,
        accessToken: credentials.accessToken,
        useCloudUpload: hasLocalhostImages,
      });
    }

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
      imagesUsed: selectedImages,
      imageCount: selectedImages.length,
      postType: selectedImages.length === 1 ? 'single' : 'carousel',
      selectedIndices: body.selectedImageIndices || Array.from({length: Math.min(moment.captures?.length || 0, 10)}, (_, i) => i),
      availableCapturesCount: moment.captures?.length || 0,
      requestedIndicesCount: body.selectedImageIndices?.length || 0,
      validIndicesProcessed: selectedImages.length,
      note: prior?.published && !body?.force
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