import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class InstagramPublishingService {
  private readonly logger = new Logger(InstagramPublishingService.name);

  constructor(private readonly httpService: HttpService) {}

  async publishToInstagram(postData: {
    caption: string;
    imageUrl?: string;
    instagramAccountId: string;
    accessToken: string;
  }): Promise<{ success: boolean; postId?: string; error?: string }> {
    try {
      const { caption, imageUrl, instagramAccountId, accessToken } = postData;

      if (!imageUrl) {
        return {
          success: false,
          error: 'Instagram requires an image. Text-only posts are not supported.'
        };
      }

      // Step 1: Create media object (upload image)
      const mediaId = await this.createMediaObject(instagramAccountId, imageUrl, caption, accessToken);

      // Step 2: Publish the media
      const postId = await this.publishMedia(instagramAccountId, mediaId, accessToken);

      this.logger.log(`Successfully published post to Instagram. Post ID: ${postId}`);
      return { success: true, postId };

    } catch (error) {
      this.logger.error(`Failed to publish to Instagram: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private async createMediaObject(
    instagramAccountId: string,
    imageUrl: string,
    caption: string,
    accessToken: string
  ): Promise<string> {
    const tryCreate = async (url: string) => {
      const payload = { image_url: url, caption, access_token: accessToken };
      const resp = await firstValueFrom(
        this.httpService.post(`https://graph.facebook.com/v20.0/${instagramAccountId}/media`, payload)
      );
      if (!resp.data?.id) throw new Error('Failed to get media ID from Instagram response');
      return resp.data.id as string;
    };

    try {
      // 1) Try the original URL exactly as provided (keep query params)
      this.logger.log(`Creating IG media with original image (no crop): ${imageUrl}`);
      return await tryCreate(imageUrl);
    } catch (error: any) {
      // 2) If ratio is invalid, retry with padded, IG-safe transformations
      if (this.isAspectRatioError(error)) {
        this.logger.warn(`Original image rejected for aspect ratio. Retrying with padded IG-safe URL...`);

        const squarePadded = this.buildIgSafeUrl(imageUrl, 'square'); // safest universal
        this.logger.log(`Retry (square padded): ${squarePadded}`);
        try {
          return await tryCreate(squarePadded);
        } catch {
          const landscapePadded = this.buildIgSafeUrl(imageUrl, 'landscape');
          this.logger.log(`Retry (landscape padded 1.91:1): ${landscapePadded}`);
          try {
            return await tryCreate(landscapePadded);
          } catch {
            const portraitPadded = this.buildIgSafeUrl(imageUrl, 'portrait');
            this.logger.log(`Retry (portrait padded 4:5): ${portraitPadded}`);
            const respId = await tryCreate(portraitPadded);
            return respId;
          }
        }
      }

      // 3) Non-aspect errors: still try a padded fallback once
      this.logger.warn(`Create media failed (non-aspect issue). Trying square padded once...`);
      const padded = this.buildIgSafeUrl(imageUrl, 'square');
      const respId = await tryCreate(padded);
      return respId;
    }
  }

  private async publishMedia(
    instagramAccountId: string,
    mediaId: string,
    accessToken: string
  ): Promise<string> {
    try {
      this.logger.log(`Publishing Instagram media. Media ID: ${mediaId}`);

      const publishPayload = {
        creation_id: mediaId,
        access_token: accessToken,
      };

      const response = await firstValueFrom(
        this.httpService.post(
          `https://graph.facebook.com/v20.0/${instagramAccountId}/media_publish`,
          publishPayload
        )
      );

      if (!response.data.id) {
        throw new Error('Failed to get post ID from Instagram publish response');
      }

      this.logger.log(`Successfully published Instagram media. Post ID: ${response.data.id}`);
      return response.data.id;

    } catch (error) {
      const errorDetails = error.response?.data || error.message;
      throw new Error(`Failed to publish Instagram media: ${JSON.stringify(errorDetails)}`);
    }
  }

  // Alternative method for carousel posts (multiple images)
  async publishCarouselToInstagram(postData: {
    caption: string;
    imageUrls: string[];
    instagramAccountId: string;
    accessToken: string;
  }): Promise<{ success: boolean; postId?: string; error?: string }> {
    try {
      const { caption, imageUrls, instagramAccountId, accessToken } = postData;

      if (!imageUrls || imageUrls.length === 0) {
        return {
          success: false,
          error: 'At least one image is required for Instagram carousel post'
        };
      }

      if (imageUrls.length > 10) {
        return {
          success: false,
          error: 'Instagram carousel posts support maximum 10 images'
        };
      }

      // Step 1: Create media objects for each image
      const mediaIds: string[] = [];

      for (const imageUrl of imageUrls) {
        const mediaId = await this.createCarouselMediaObject(instagramAccountId, imageUrl, accessToken);
        mediaIds.push(mediaId);
      }

      // Step 2: Create carousel container
      const containerId = await this.createCarouselContainer(
        instagramAccountId,
        mediaIds,
        caption,
        accessToken
      );

      // Step 3: Publish the carousel
      const postId = await this.publishMedia(instagramAccountId, containerId, accessToken);

      this.logger.log(`Successfully published carousel to Instagram. Post ID: ${postId}`);
      return { success: true, postId };

    } catch (error) {
      this.logger.error(`Failed to publish carousel to Instagram: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private async createCarouselMediaObject(
    instagramAccountId: string,
    imageUrl: string,
    accessToken: string
  ): Promise<string> {
    const tryCreate = async (url: string) => {
      const payload = { image_url: url, is_carousel_item: true, access_token: accessToken };
      const resp = await firstValueFrom(
        this.httpService.post(`https://graph.facebook.com/v20.0/${instagramAccountId}/media`, payload)
      );
      if (!resp.data?.id) throw new Error('Failed to get carousel media ID from Instagram response');
      return resp.data.id as string;
    };

    try {
      this.logger.log(`Creating IG carousel media with original image: ${imageUrl}`);
      return await tryCreate(imageUrl);
    } catch (error: any) {
      if (this.isAspectRatioError(error)) {
        this.logger.warn(`Carousel item rejected for aspect ratio. Retrying with padded IG-safe URL...`);

        const squarePadded = this.buildIgSafeUrl(imageUrl, 'square');
        this.logger.log(`Retry (square padded): ${squarePadded}`);
        try {
          return await tryCreate(squarePadded);
        } catch {
          const landscapePadded = this.buildIgSafeUrl(imageUrl, 'landscape');
          this.logger.log(`Retry (landscape padded 1.91:1): ${landscapePadded}`);
          try {
            return await tryCreate(landscapePadded);
          } catch {
            const portraitPadded = this.buildIgSafeUrl(imageUrl, 'portrait');
            this.logger.log(`Retry (portrait padded 4:5): ${portraitPadded}`);
            return await tryCreate(portraitPadded);
          }
        }
      }

      // generic padded fallback
      const padded = this.buildIgSafeUrl(imageUrl, 'square');
      return await tryCreate(padded);
    }
  }

  private async createCarouselContainer(
    instagramAccountId: string,
    mediaIds: string[],
    caption: string,
    accessToken: string
  ): Promise<string> {
    const containerPayload = {
      media_type: 'CAROUSEL',
      children: mediaIds.join(','),
      caption: caption,
      access_token: accessToken,
    };

    const response = await firstValueFrom(
      this.httpService.post(
        `https://graph.facebook.com/v20.0/${instagramAccountId}/media`,
        containerPayload
      )
    );

    if (!response.data.id) {
      throw new Error('Failed to get carousel container ID from Instagram response');
    }

    return response.data.id;
  }

  async validateCredentials(instagramAccountId: string, accessToken: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v20.0/${instagramAccountId}?fields=id,username&access_token=${accessToken}`
        )
      );

      return response.data.id === instagramAccountId;
    } catch (error) {
      this.logger.error(`Invalid Instagram credentials: ${error.message}`);
      return false;
    }
  }

  async getInstagramAccountInfo(instagramAccountId: string, accessToken: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v20.0/${instagramAccountId}?fields=id,username,name,profile_picture_url,followers_count,media_count&access_token=${accessToken}`
        )
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to get Instagram account info: ${error.message}`);
      throw error;
    }
  }

  async getRecentPosts(instagramAccountId: string, accessToken: string, limit: number = 10): Promise<any[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v20.0/${instagramAccountId}/media?fields=id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count&limit=${limit}&access_token=${accessToken}`
        )
      );

      return response.data?.data || [];
    } catch (error) {
      this.logger.error(`Failed to get Instagram recent posts: ${error.message}`);
      throw error;
    }
  }

  async getPostInsights(postId: string, accessToken: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v20.0/${postId}/insights?metric=impressions,reach,likes,comments,saves,shares&access_token=${accessToken}`
        )
      );

      return response.data?.data || [];
    } catch (error) {
      this.logger.error(`Failed to get Instagram post insights: ${error.message}`);
      throw error;
    }
  }

  private buildIgSafeUrl(
    originalUrl: string,
    mode: 'square' | 'portrait' | 'landscape' = 'square'
  ): string {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

    if (cloudName) {
      const tx =
        mode === 'portrait'
          ? 'c_pad,g_auto,b_auto:predominant,ar_4:5,w_1080,h_1350,f_jpg,q_auto:good,e_improve'
          : mode === 'landscape'
            ? 'c_pad,g_auto,b_auto:predominant,ar_1.91,w_1080,h_566,f_jpg,q_auto:good,e_improve'
            : 'c_pad,g_auto,b_auto:predominant,ar_1:1,w_1080,h_1080,f_jpg,q_auto:good,e_improve';

      return `https://res.cloudinary.com/${cloudName}/image/fetch/${tx}/${encodeURIComponent(originalUrl)}`;
    }

    const noProto = originalUrl.replace(/^https?:\/\//i, '');
    const dims =
      mode === 'portrait'
        ? 'w=1080&h=1350'
        : mode === 'landscape'
          ? 'w=1080&h=566'
          : 'w=1080&h=1080';

    return `https://images.weserv.nl/?url=${encodeURIComponent(noProto)}&${dims}&fit=contain&bg=ffffff&output=jpg&dpr=2`;
  }

  private isAspectRatioError(err: any): boolean {
    const e = err?.response?.data?.error || err;
    const msg = (e?.message || '').toString().toLowerCase();
    return (
      e?.code === 36003 ||
      e?.error_subcode === 2207009 ||
      msg.includes('aspect ratio') ||
      msg.includes('invalid aspect ratio')
    );
  }

  async mediaExists(mediaId: string, accessToken: string): Promise<boolean> {
    try {
      const resp = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v20.0/${mediaId}?fields=id&access_token=${accessToken}`
        )
      );
      return !!resp.data?.id;
    } catch (e: any) {
      const err = e?.response?.data?.error;
      const msg = (err?.message || '').toLowerCase();

      const notFound =
        e?.response?.status === 404 ||
        err?.code === 100 ||
        err?.code === 803 ||
        msg.includes('object does not exist') ||
        msg.includes('cannot be found') ||
        msg.includes('unknown path');

      if (notFound) return false;

      if (err?.code === 190) {
        throw new Error(`Invalid or expired access token when checking media existence.`);
      }

      this.logger.warn(`mediaExists inconclusive: ${JSON.stringify(err || e.message)}`);
      return false;
    }
  }

  async getPermalink(mediaId: string, accessToken: string): Promise<string | null> {
    try {
      const resp = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v20.0/${mediaId}?fields=permalink&access_token=${accessToken}`
        )
      );
      return resp.data?.permalink || null;
    } catch (e: any) {
      this.logger.warn(
        `Failed to fetch permalink for ${mediaId}: ${e?.response?.data?.error?.message || e.message}`
      );
      return null;
    }
  }
}
