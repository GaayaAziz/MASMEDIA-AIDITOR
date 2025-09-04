import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class FacebookPublishingService {
  private readonly logger = new Logger(FacebookPublishingService.name);

  constructor(private readonly httpService: HttpService) {}

  async publishToFacebook(postData: {
    title: string;
    message: string;
    imageUrl?: string;
    link?: string;
    pageId: string;
    pageAccessToken: string;
  }): Promise<{ success: boolean; postId?: string; error?: string }> {
    try {
      const { message, imageUrl, link, pageId, pageAccessToken } = postData;

      const postPayload: any = {
        message,
        access_token: pageAccessToken,
      };

      if (link) postPayload.link = link;

      let postId: string;
      if (imageUrl) {
        postId = await this.publishWithImage(pageId, postPayload, imageUrl);
      } else {
        postId = await this.publishTextPost(pageId, postPayload);
      }

      this.logger.log(`Successfully published post to Facebook. Post ID: ${postId}`);
      return { success: true, postId };

    } catch (error: any) {
      const details = error?.response?.data || error?.message;
      this.logger.error(`Failed to publish to Facebook: ${JSON.stringify(details)}`);
      return { success: false, error: error.message };
    }
  }

  private async publishTextPost(pageId: string, postPayload: any): Promise<string> {
    const response = await firstValueFrom(
      this.httpService.post(`https://graph.facebook.com/v20.0/${pageId}/feed`, postPayload)
    );

    if (!response.data?.id) throw new Error('Failed to get post ID from Facebook response');
    return response.data.id;
  }

private async publishWithImage(pageId: string, postPayload: any, imageUrl: string): Promise<string> {
  const tryPhoto = async (url: string) => {
    const payload = {
      url,
      caption: postPayload.message,
      access_token: postPayload.access_token,
    };
    const resp = await firstValueFrom(
      this.httpService.post(`https://graph.facebook.com/v20.0/${pageId}/photos`, payload)
    );
    if (!resp.data?.id) throw new Error('Failed to get photo ID from Facebook response');
    return resp.data.id as string;
  };

  const tryPhotoUpload = async (buffer: Buffer, filename: string) => {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('source', buffer, { filename });
    form.append('caption', postPayload.message);
    form.append('access_token', postPayload.access_token);

    const headers = form.getHeaders();
    const resp = await firstValueFrom(
      this.httpService.post(`https://graph.facebook.com/v20.0/${pageId}/photos`, form, { headers })
    );
    if (!resp.data?.id) throw new Error('Failed to get photo ID from Facebook response');
    return resp.data.id as string;
  };

  // Check if it's a localhost URL
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(imageUrl);
  
  if (isLocalhost) {
    try {
      this.logger.log(`Uploading local media to Facebook: ${imageUrl}`);
      // Fetch the media from localhost and upload as binary
      const mediaResponse = await firstValueFrom(
        this.httpService.get(imageUrl, { responseType: 'arraybuffer' })
      );
      const buffer = Buffer.from(mediaResponse.data);
      const filename = imageUrl.split('/').pop() || (imageUrl.includes('.gif') ? 'media.gif' : 'media.jpg');
      return await tryPhotoUpload(buffer, filename);
    } catch (err: any) {
      this.logger.error(`Local media upload failed: ${err.message}`);
      throw err;
    }
  }

  try {
    // For public URLs, try the original URL first (works for both images and GIFs)
    this.logger.log(`Uploading media to Facebook (original URL): ${imageUrl}`);
    return await tryPhoto(imageUrl);
  } catch (err: any) {
    const details = err?.response?.data || err?.message;
    this.logger.warn(`Original URL upload failed. Details: ${JSON.stringify(details)}`);

    // For GIFs, don't transform - just try direct upload or fallback to text
    if (imageUrl.toLowerCase().includes('.gif')) {
      this.logger.warn(`GIF upload failed, falling back to text-only post`);
      const textOnlyPayload = {
        message: `${postPayload.message}\n\n[GIF could not be loaded: ${imageUrl}]`,
        access_token: postPayload.access_token,
      };
      const response = await firstValueFrom(
        this.httpService.post(`https://graph.facebook.com/v20.0/${pageId}/feed`, textOnlyPayload)
      );
      if (!response.data?.id) throw new Error('Failed to get post ID from Facebook response');
      this.logger.warn(`Posted as text only due to GIF upload issues. Post ID: ${response.data.id}`);
      return response.data.id as string;
    }

    // For images, retry with transformed URL
    const safeUrl = this.buildFbSafeUrl(imageUrl, 'landscape');
    this.logger.log(`Retry with transformed URL: ${safeUrl}`);
    try {
      return await tryPhoto(safeUrl);
    } catch (tErr: any) {
      this.logger.warn(`Transformed upload failed. Details: ${JSON.stringify(tErr?.response?.data || tErr?.message)}`);

      // Fallback: text only
      const textOnlyPayload = {
        message: `${postPayload.message}\n\n[Media could not be loaded: ${imageUrl}]`,
        access_token: postPayload.access_token,
      };
      const response = await firstValueFrom(
        this.httpService.post(`https://graph.facebook.com/v20.0/${pageId}/feed`, textOnlyPayload)
      );
      if (!response.data?.id) throw new Error('Failed to get post ID from Facebook response');
      this.logger.warn(`Posted as text only due to media upload issues. Post ID: ${response.data.id}`);
      return response.data.id as string;
    }
  }
}
  

  async validateCredentials(pageId: string, pageAccessToken: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v20.0/${pageId}?fields=id,name&access_token=${pageAccessToken}`
        )
      );
      return response.data.id === pageId;
    } catch (error) {
      this.logger.error(`Invalid Facebook credentials: ${error.message}`);
      return false;
    }
  }

  async getPageInfo(pageId: string, pageAccessToken: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v20.0/${pageId}?fields=id,name,username,category,fan_count&access_token=${pageAccessToken}`
        )
      );
      return response.data;
    } catch (error: any) {
      this.logger.error(`Failed to get page info: ${error.message}`);
      throw error;
    }
  }

  /** ✅ NEW: check if a post/photo ID still exists on Facebook */
  async objectExists(objectId: string, accessToken: string): Promise<boolean> {
    try {
      const resp = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v20.0/${objectId}?fields=id&access_token=${accessToken}`
        )
      );
      return !!resp.data?.id;
    } catch (e: any) {
      const err = e?.response?.data?.error;
      const msg = (err?.message || '').toLowerCase();

      const notFound =
        e?.response?.status === 404 ||
        err?.code === 100 ||   // (#100) Object does not exist
        err?.code === 803 ||   // Unknown object
        msg.includes('object does not exist') ||
        msg.includes('cannot be found') ||
        msg.includes('unknown path');

      if (notFound) return false;

      if (err?.code === 190) {
        // Invalid token — let caller handle as credentials problem
        throw new Error('Invalid or expired access token when checking Facebook object.');
      }

      // Be permissive: assume it doesn't exist so user can re-post.
      this.logger.warn(`objectExists inconclusive: ${JSON.stringify(err || e.message)}`);
      return false;
    }
  }

  /** ✅ NEW: get a nice permalink for the created object (post/photo) */
  async getPermalink(objectId: string, accessToken: string): Promise<string | null> {
    try {
      const resp = await firstValueFrom(
        this.httpService.get(
          `https://graph.facebook.com/v20.0/${objectId}?fields=permalink_url&access_token=${accessToken}`
        )
      );
      return resp.data?.permalink_url || null;
    } catch (e: any) {
      this.logger.warn(
        `Failed to fetch Facebook permalink for ${objectId}: ${e?.response?.data?.error?.message || e.message}`
      );
      return null;
    }
  }

  private buildFbSafeUrl(
    originalUrl: string,
    mode: 'square' | 'portrait' | 'landscape' = 'landscape'
  ): string {
    // Prefer Cloudinary if CLOUDINARY_CLOUD_NAME is set
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  
    // Recommended FB feed sizes (pad to keep whole image)
    // landscape = 1200x630 (≈1.91:1), portrait = 1080x1350 (4:5), square = 1080x1080 (1:1)
    if (cloudName) {
      const tx =
        mode === 'portrait'
          ? 'c_pad,g_auto,b_auto:predominant,ar_4:5,w_1080,h_1350,f_jpg,q_auto:good,e_improve'
          : mode === 'square'
            ? 'c_pad,g_auto,b_auto:predominant,ar_1:1,w_1080,h_1080,f_jpg,q_auto:good,e_improve'
            : 'c_pad,g_auto,b_auto:predominant,ar_1.91,w_1200,h_630,f_jpg,q_auto:good,e_improve';
      return `https://res.cloudinary.com/${cloudName}/image/fetch/${tx}/${encodeURIComponent(originalUrl)}`;
    }
  
    // Fallback transformer
    const noProto = originalUrl.replace(/^https?:\/\//i, '');
    const dims =
      mode === 'portrait' ? 'w=1080&h=1350'
      : mode === 'square' ? 'w=1080&h=1080'
      : 'w=1200&h=630';
    // fit=contain pads (no crop), bg white; dpr=2 for sharper preview
    return `https://images.weserv.nl/?url=${encodeURIComponent(noProto)}&${dims}&fit=contain&bg=ffffff&output=jpg&dpr=2`;
  }
  
  
    async publishPhotoAlbum(postData: {
  message: string;
  imageUrls: string[];
  pageId: string;
  pageAccessToken: string;
}): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    const { message, imageUrls, pageId, pageAccessToken } = postData;

    if (!imageUrls || imageUrls.length === 0) {
      return {
        success: false,
        error: 'At least one image is required for photo album'
      };
    }

    if (imageUrls.length === 1) {
      // For single image, use the regular photo upload method
      const result = await this.publishWithImage(pageId, { message, access_token: pageAccessToken }, imageUrls[0]);
      return {
        success: true,
        postId: result
      };
    }

    // For multiple images, create a proper album/carousel post
    const attachments = [];
    const maxRetries = 2;
    
    // Process each image with retry logic
    for (let i = 0; i < imageUrls.length && i < 6; i++) {
      const imageUrl = imageUrls[i];
      let photoId = null;
      
      for (let retry = 0; retry <= maxRetries; retry++) {
        try {
          this.logger.log(`Uploading image ${i + 1}/${imageUrls.length} (attempt ${retry + 1}): ${imageUrl}`);
          photoId = await this.uploadUnpublishedPhoto(pageId, imageUrl, pageAccessToken);
          break; // Success, exit retry loop
        } catch (error: any) {
          this.logger.warn(`Failed to upload image ${imageUrl} (attempt ${retry + 1}): ${error.message}`);
          
          if (retry === maxRetries) {
            // Final attempt failed, log but continue with other images
            this.logger.error(`Giving up on image ${imageUrl} after ${maxRetries + 1} attempts`);
          } else {
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retry)));
          }
        }
      }
      
      if (photoId) {
        attachments.push({
          media_fbid: photoId
        });
        this.logger.log(`Successfully uploaded image ${i + 1}, got photo ID: ${photoId}`);
        
        // Small delay between successful uploads to avoid overwhelming the API
        if (i < imageUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    if (attachments.length === 0) {
      throw new Error('Failed to upload any images for album');
    }

    this.logger.log(`Creating Facebook album post with ${attachments.length} images`);

    // Create the album post with all attachments
    const postPayload = {
      message,
      attached_media: JSON.stringify(attachments),
      access_token: pageAccessToken,
    };

    // Retry logic for the final post creation
    let response;
    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        response = await firstValueFrom(
          this.httpService.post(`https://graph.facebook.com/v20.0/${pageId}/feed`, postPayload, {
            timeout: 30000, // 30 second timeout
          })
        );
        break;
      } catch (error: any) {
        if (retry === maxRetries) {
          throw error;
        }
        this.logger.warn(`Post creation attempt ${retry + 1} failed: ${error.message}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!response.data?.id) {
      throw new Error('Failed to get post ID from Facebook album response');
    }

    this.logger.log(`Successfully created Facebook album with ${attachments.length} images. Post ID: ${response.data.id}`);
    
    return { 
      success: true, 
      postId: response.data.id
    };

  } catch (error: any) {
    const details = error?.response?.data || error?.message;
    this.logger.error(`Failed to publish photo album to Facebook: ${JSON.stringify(details)}`);
    return { success: false, error: error.message };
  }
}
async publishMixedMediaAlbum(postData: {
  message: string;
  mediaUrls: string[];
  pageId: string;
  pageAccessToken: string;
}): Promise<{ success: boolean; postIds?: string[]; error?: string }> {
  try {
    const { message, mediaUrls, pageId, pageAccessToken } = postData;

    if (!mediaUrls || mediaUrls.length === 0) {
      return {
        success: false,
        error: 'At least one media item is required'
      };
    }

    if (mediaUrls.length === 1) {
      // Single item - handle appropriately
      const result = await this.publishSingleMedia({
        message,
        mediaUrl: mediaUrls[0],
        pageId,
        pageAccessToken
      });
      return {
        success: result.success,
        postIds: result.success ? [result.postId!] : undefined,
        error: result.error
      };
    }

    // For multiple items, create a single photo album
    // Convert all media to static images for album inclusion
    const imageUrls = mediaUrls.map(url => {
      // If it's a GIF, we'll upload it as a static image to the album
      // Facebook will automatically take the first frame
      return url;
    });

    this.logger.log(`Creating single photo album with ${imageUrls.length} items (GIFs will be static)`);

    // Create single photo album with all media
    const albumResult = await this.publishPhotoAlbum({
      message,
      imageUrls,
      pageId,
      pageAccessToken
    });

    if (!albumResult.success || !albumResult.postId) {
      throw new Error(`Failed to create photo album: ${albumResult.error}`);
    }

    this.logger.log(`Successfully created photo album with ${imageUrls.length} items: ${albumResult.postId}`);
    
    return { 
      success: true, 
      postIds: [albumResult.postId]
    };

  } catch (error: any) {
    const details = error?.response?.data || error?.message;
    this.logger.error(`Failed to publish mixed media album to Facebook: ${JSON.stringify(details)}`);
    return { success: false, error: error.message };
  }
}

private async publishSingleMedia(data: {
  message: string;
  mediaUrl: string;
  pageId: string;
  pageAccessToken: string;
}): Promise<{ success: boolean; postId?: string; error?: string }> {
  const { message, mediaUrl, pageId, pageAccessToken } = data;

  if (mediaUrl.toLowerCase().includes('.gif')) {
    // Upload GIF as video
    try {
      const videoId = await this.uploadGifAsVideo(pageId, mediaUrl, message, pageAccessToken);
      return { success: true, postId: videoId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  } else {
    // Upload as photo
    return await this.publishToFacebook({
      title: '',
      message,
      imageUrl: mediaUrl,
      pageId,
      pageAccessToken
    });
  }
}

private async uploadGifAsVideo(
  pageId: string,
  gifUrl: string,
  message: string,
  pageAccessToken: string
): Promise<string> {
  
  const tryVideoBufferUpload = async (buffer: Buffer, filename: string) => {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('source', buffer, { filename });
    form.append('description', message);
    form.append('access_token', pageAccessToken);

    const headers = form.getHeaders();
    const resp = await firstValueFrom(
      this.httpService.post(`https://graph.facebook.com/v20.0/${pageId}/videos`, form, { 
        headers,
        timeout: 180000, // 3 minute timeout for video uploads
        maxContentLength: 100 * 1024 * 1024, // 100MB limit
        maxBodyLength: 100 * 1024 * 1024,
      })
    );
    
    if (!resp.data?.id) throw new Error('Failed to get video ID from Facebook response');
    return resp.data.id as string;
  };

  // Check if it's a localhost URL
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(gifUrl);
  
  if (isLocalhost) {
    try {
      this.logger.log(`Uploading local GIF as video: ${gifUrl}`);
      
      // Fetch the GIF from localhost and upload as binary
      const gifResponse = await firstValueFrom(
        this.httpService.get(gifUrl, { 
          responseType: 'arraybuffer',
          timeout: 60000,
          maxContentLength: 100 * 1024 * 1024, // 100MB limit
        })
      );
      
      const buffer = Buffer.from(gifResponse.data);
      const filename = gifUrl.split('/').pop() || 'animation.gif';
      
      return await tryVideoBufferUpload(buffer, filename);
      
    } catch (err: any) {
      this.logger.error(`Local GIF video upload failed: ${err.message}`);
      throw new Error(`Local GIF video upload failed: ${err.message}`);
    }
  }

  // For public URLs - Facebook doesn't support direct URL video upload like photos
  // So we need to fetch and upload as buffer
  try {
    this.logger.log(`Fetching and uploading public GIF as video: ${gifUrl}`);
    
    const gifResponse = await firstValueFrom(
      this.httpService.get(gifUrl, { 
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024,
      })
    );
    
    const buffer = Buffer.from(gifResponse.data);
    const filename = gifUrl.split('/').pop() || 'animation.gif';
    
    return await tryVideoBufferUpload(buffer, filename);
    
  } catch (err: any) {
    this.logger.error(`Public GIF video upload failed: ${err.message}`);
    throw new Error(`Failed to upload GIF as video: ${err.message}`);
  }
}
private async uploadUnpublishedPhoto(
  pageId: string, 
  imageUrl: string, 
  pageAccessToken: string
): Promise<string> {
  
  const tryPhotoUpload = async (url: string) => {
    const payload = {
      url,
      published: false,
      access_token: pageAccessToken,
    };
    
    const resp = await firstValueFrom(
      this.httpService.post(`https://graph.facebook.com/v20.0/${pageId}/photos`, payload, {
        timeout: 45000, // 45 second timeout
      })
    );
    
    if (!resp.data?.id) throw new Error('Failed to get photo ID from Facebook response');
    return resp.data.id as string;
  };

  const tryPhotoBufferUpload = async (buffer: Buffer, filename: string) => {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('source', buffer, { filename });
    form.append('published', 'false');
    form.append('access_token', pageAccessToken);

    const headers = form.getHeaders();
    const resp = await firstValueFrom(
      this.httpService.post(`https://graph.facebook.com/v20.0/${pageId}/photos`, form, { 
        headers,
        timeout: 60000, // 60 second timeout for buffer uploads
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      })
    );
    
    if (!resp.data?.id) throw new Error('Failed to get photo ID from Facebook response');
    return resp.data.id as string;
  };

  // Check if it's a localhost URL
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(imageUrl);
  
  if (isLocalhost) {
    try {
      this.logger.log(`Uploading local media for album: ${imageUrl}`);
      
      // Fetch the media from localhost and upload as binary
      const mediaResponse = await firstValueFrom(
        this.httpService.get(imageUrl, { 
          responseType: 'arraybuffer',
          timeout: 30000,
          maxContentLength: 50 * 1024 * 1024, // 50MB limit
        })
      );
      
      const buffer = Buffer.from(mediaResponse.data);
      const filename = imageUrl.split('/').pop() || (imageUrl.includes('.gif') ? 'media.gif' : 'media.jpg');
      
      return await tryPhotoBufferUpload(buffer, filename);
      
    } catch (err: any) {
      this.logger.error(`Local media upload failed for album: ${err.message}`);
      throw new Error(`Local media upload failed: ${err.message}`);
    }
  }

  // For public URLs, try the original URL first (works for both images and GIFs)
  try {
    this.logger.log(`Uploading media for album (original URL): ${imageUrl}`);
    return await tryPhotoUpload(imageUrl);
    
  } catch (err: any) {
    this.logger.warn(`Original URL upload failed for album. Details: ${JSON.stringify(err?.response?.data || err?.message)}`);

    // For GIFs, don't transform - just fail
    if (imageUrl.toLowerCase().includes('.gif')) {
      this.logger.error(`GIF upload failed for album, cannot transform GIFs: ${imageUrl}`);
      throw new Error(`Failed to upload GIF for Facebook album: ${err.message}`);
    }

    // For images, retry with transformed URL
    const safeUrl = this.buildFbSafeUrl(imageUrl, 'landscape');
    this.logger.log(`Retry album upload with transformed URL: ${safeUrl}`);
    
    try {
      return await tryPhotoUpload(safeUrl);
    } catch (tErr: any) {
      this.logger.error(`Transformed upload failed for album. Details: ${JSON.stringify(tErr?.response?.data || tErr?.message)}`);
      throw new Error(`Failed to upload image for Facebook album: ${tErr.message}`);
    }
  }
}

  
}
