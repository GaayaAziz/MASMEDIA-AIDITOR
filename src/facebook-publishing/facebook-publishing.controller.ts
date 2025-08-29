import { Controller, Post, Body, Get, Param, HttpException, HttpStatus, Query } from '@nestjs/common';
import { FacebookPublishingService } from './facebook-publishing.service';
import { FacebookCredentialsService } from './facebook-credentials.service';
import { PostsService } from '../posts/posts.service';
import { HotMomentService } from 'src/hot-moment/hot-moment.service';

@Controller('facebook')
export class FacebookPublishingController {
  constructor(
    private readonly facebookService: FacebookPublishingService,
    private readonly credentialsService: FacebookCredentialsService,
    private readonly postsService: PostsService,
    private readonly hotMomentService: HotMomentService,
  ) {}

  @Post('publish/:postId')
  async publishPost(
    @Param('postId') postId: string,
    @Body() body: {
      userId?: string;
      pageId?: string;
      pageAccessToken?: string;
      force?: boolean; // ✅ allow override
    }
  ) {
    try {
      const post = await this.postsService.getPostById(postId);
      if (!post) {
        throw new HttpException('Post not found', HttpStatus.NOT_FOUND);
      }

      // Acquire credentials first (we may need them to verify remote state)
      let credentials: { pageId: string; pageAccessToken: string };
      if (body.pageId && body.pageAccessToken) {
        credentials = { pageId: body.pageId, pageAccessToken: body.pageAccessToken };
      } else {
        const storedCredentials = await this.credentialsService.getCredentials(body.userId || 'default');
        if (!storedCredentials) {
          throw new HttpException('Facebook credentials not found. Please authenticate first.', HttpStatus.UNAUTHORIZED);
        }
        credentials = { pageId: storedCredentials.pageId, pageAccessToken: storedCredentials.pageAccessToken };
      }

      const isValid = await this.facebookService.validateCredentials(
        credentials.pageId,
        credentials.pageAccessToken
      );
      if (!isValid) {
        throw new HttpException('Invalid Facebook credentials', HttpStatus.UNAUTHORIZED);
      }

      // If our DB says "already published", confirm it still exists on Facebook
      const prior = post.publishedTo?.facebook;
      if (prior?.published && prior?.publishedId && !body?.force) {
        const stillExists = await this.facebookService.objectExists(
          prior.publishedId,
          credentials.pageAccessToken
        );

        if (stillExists) {
          throw new HttpException('Post already published to Facebook', HttpStatus.CONFLICT);
        } else {
          // It was deleted / not accessible -> clear local state and proceed
          await this.postsService.clearPublished(postId, 'facebook');
        }
      }

      const result = await this.facebookService.publishToFacebook({
        title: post.title,
        message: post.platforms.facebook,
        imageUrl: post.imageUrl,
        link: post.sourceUrl,
        pageId: credentials.pageId,
        pageAccessToken: credentials.pageAccessToken,
      });

      if (!result.success || !result.postId) {
        throw new HttpException(`Failed to publish to Facebook: ${result.error}`, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      // Save publish state
      await this.postsService.markAsPublished(postId, 'facebook', result.postId);

      // Try to fetch a nicer permalink
      const permalink = await this.facebookService.getPermalink(result.postId, credentials.pageAccessToken);

      return {
        success: true,
        message: 'Post published successfully to Facebook',
        facebookPostId: result.postId,
        facebookUrl: permalink ?? `https://www.facebook.com/${result.postId}`,
        originalPost: {
          id: post._id,
          title: post.title,
          sourceName: post.sourceName,
        },
        note:
          prior?.published && !body?.force
            ? 'The previous Facebook object no longer existed; state was reset and the post was re-published.'
            : undefined,
      };

    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(`Error publishing to Facebook: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
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

      let credentials: { pageId: string; pageAccessToken: string };
      if (body.pageId && body.pageAccessToken) {
        credentials = { pageId: body.pageId, pageAccessToken: body.pageAccessToken };
      } else {
        const storedCredentials = await this.credentialsService.getCredentials(body.userId || 'default');
        if (!storedCredentials) {
          throw new HttpException('Facebook credentials not found. Please authenticate first.', HttpStatus.UNAUTHORIZED);
        }
        credentials = { pageId: storedCredentials.pageId, pageAccessToken: storedCredentials.pageAccessToken };
      }

      const isValid = await this.facebookService.validateCredentials(
        credentials.pageId,
        credentials.pageAccessToken
      );
      if (!isValid) {
        throw new HttpException('Invalid Facebook credentials', HttpStatus.UNAUTHORIZED);
      }

      const result = await this.facebookService.publishToFacebook({
        title: 'Test Post',
        message: body.message,
        imageUrl: body.imageUrl,
        link: body.link,
        pageId: credentials.pageId,
        pageAccessToken: credentials.pageAccessToken,
      });

      if (!result.success || !result.postId) {
        throw new HttpException(`Failed to publish: ${result.error}`, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      const permalink = await this.facebookService.getPermalink(result.postId, credentials.pageAccessToken);

      return {
        success: true,
        message: 'Test post published successfully',
        facebookPostId: result.postId,
        facebookUrl: permalink ?? `https://www.facebook.com/${result.postId}`,
      };

    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('page-info')
  async getPageInfo(@Query('pageId') pageId: string, @Query('pageAccessToken') pageAccessToken: string) {
    try {
      if (!pageId || !pageAccessToken) {
        throw new HttpException('pageId and pageAccessToken query parameters are required', HttpStatus.BAD_REQUEST);
      }

      const pageInfo = await this.facebookService.getPageInfo(pageId, pageAccessToken);
      return { success: true, pageInfo };

    } catch (error) {
      throw new HttpException(`Failed to get page info: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('validate-credentials')
  async validateCredentials(@Body() body: { pageId: string; pageAccessToken: string }) {
    try {
      if (!body.pageId || !body.pageAccessToken) {
        throw new HttpException('pageId and pageAccessToken are required', HttpStatus.BAD_REQUEST);
      }

      const isValid = await this.facebookService.validateCredentials(body.pageId, body.pageAccessToken);
      return {
        success: true,
        valid: isValid,
        message: isValid ? 'Credentials are valid' : 'Credentials are invalid'
      };

    } catch (error) {
      throw new HttpException(`Error validating credentials: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
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
      throw new HttpException(`Error fetching published posts: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('publish-hot-moment/:hotMomentId')
  async publishHotMoment(
    @Param('hotMomentId') hotMomentId: string,
    @Body()
    body: {
      userId?: string;
      pageId?: string;
      pageAccessToken?: string;
      captureIndex?: number;   // which capture to use (default 0)
      preferGif?: boolean;     // prefer GIF over screenshot when both exist
      force?: boolean;         // ignore local published state if remote object is gone
      overrideMessage?: string; // optionally override the text
      overrideImage?: string;   // optionally override image (url or local path)
    }
  ) {
    try {
      // 1) Load the hot moment
      const moment = await this.hotMomentService.getHotMomentById(hotMomentId);
      if (!moment) {
        throw new HttpException('Hot moment not found', HttpStatus.NOT_FOUND);
      }

      // 2) Resolve credentials
      let credentials: { pageId: string; pageAccessToken: string };
      if (body.pageId && body.pageAccessToken) {
        credentials = { pageId: body.pageId, pageAccessToken: body.pageAccessToken };
      } else {
        const stored = await this.credentialsService.getCredentials(body.userId || 'default');
        if (!stored) {
          throw new HttpException('Facebook credentials not found. Please authenticate first.', HttpStatus.UNAUTHORIZED);
        }
        credentials = { pageId: stored.pageId, pageAccessToken: stored.pageAccessToken };
      }

      // 3) Validate credentials
      const ok = await this.facebookService.validateCredentials(credentials.pageId, credentials.pageAccessToken);
      if (!ok) throw new HttpException('Invalid Facebook credentials', HttpStatus.UNAUTHORIZED);

      // 4) Already published? verify remote existence unless force
      const prior = moment.publishedTo?.facebook;
      if (prior?.published && prior?.publishedId && !body?.force) {
        const exists = await this.facebookService.objectExists(prior.publishedId, credentials.pageAccessToken);
        if (exists) {
          throw new HttpException('Hot moment already published to Facebook', HttpStatus.CONFLICT);
        } else {
          await this.hotMomentService.clearPublishedHotMoment(hotMomentId, 'facebook');
        }
      }

      // 5) Choose message text
      const message =
        body.overrideMessage?.trim() ||
        moment.posts?.facebook?.toString()?.trim() ||
        moment.content?.trim() ||
        moment.moment_title ||
        'New update';

      // 6) Choose media - FIXED: Use URL fields instead of path fields
      let chosenMedia: string | undefined = body.overrideImage;
      if (!chosenMedia && Array.isArray(moment.captures) && moment.captures.length > 0) {
        const idx = Math.max(0, Math.min(moment.captures.length - 1, body.captureIndex ?? 0));
        const cap = moment.captures[idx] as { 
          offset: number; 
          screenshotPath: string; 
          gifPath: string;
          screenshotUrl: string;
          gifUrl: string;
        };
        
        if (body.preferGif && cap.gifUrl) {
          chosenMedia = cap.gifUrl;
        } else {
          chosenMedia = cap.screenshotUrl || cap.gifUrl || undefined;
        }
      }

      // 7) Publish
      const result = await this.facebookService.publishToFacebook({
        title: moment.moment_title,
        message,
        imageUrl: chosenMedia,
        link: undefined,
        pageId: credentials.pageId,
        pageAccessToken: credentials.pageAccessToken,
      });

      if (!result.success || !result.postId) {
        throw new HttpException(`Failed to publish hot moment to Facebook: ${result.error}`, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      // 8) Persist state
      await this.hotMomentService.markAsPublishedHotMoment(hotMomentId, 'facebook', result.postId);

      // 9) Permalink
      const permalink = await this.facebookService.getPermalink(result.postId, credentials.pageAccessToken);

      return {
        success: true,
        message: 'Hot moment published to Facebook',
        facebookPostId: result.postId,
        facebookUrl: permalink ?? `https://www.facebook.com/${result.postId}`,
        note:
          prior?.published && !body?.force
            ? 'Previous Facebook object no longer existed; state was reset and the hot moment was re-published.'
            : undefined,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(`Error publishing hot moment to Facebook: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}