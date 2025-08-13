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
        message: message,
        access_token: pageAccessToken,
      };

      if (link) {
        postPayload.link = link;
      }

      let postId: string;

      if (imageUrl) {
        postId = await this.publishWithImage(pageId, postPayload, imageUrl);
      } else {
        postId = await this.publishTextPost(pageId, postPayload);
      }

      this.logger.log(`Successfully published post to Facebook. Post ID: ${postId}`);
      return { success: true, postId };

    } catch (error) {
      this.logger.error(`Failed to publish to Facebook: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private async publishTextPost(pageId: string, postPayload: any): Promise<string> {
    const response = await firstValueFrom(
      this.httpService.post(
        `https://graph.facebook.com/v20.0/${pageId}/feed`,
        postPayload
      )
    );

    if (!response.data.id) {
      throw new Error('Failed to get post ID from Facebook response');
    }

    return response.data.id;
  }

  private async publishWithImage(pageId: string, postPayload: any, imageUrl: string): Promise<string> {
    try {
      // Clean the image URL - remove query parameters that might cause issues
      const cleanImageUrl = imageUrl.split('?')[0];
      this.logger.log(`Attempting to upload image: ${cleanImageUrl}`);
  
      // First, try to upload the photo with caption
      const photoPayload = {
        url: cleanImageUrl,
        caption: postPayload.message,
        access_token: postPayload.access_token,
      };
  
      const photoResponse = await firstValueFrom(
        this.httpService.post(
          `https://graph.facebook.com/v20.0/${pageId}/photos`,
          photoPayload
        )
      );
  
      if (!photoResponse.data.id) {
        throw new Error('Failed to get photo ID from Facebook response');
      }
  
      this.logger.log(`Successfully uploaded photo. Photo ID: ${photoResponse.data.id}`);
      return photoResponse.data.id;
  
    } catch (error) {
      // Log the full error response from Facebook
      const errorDetails = error.response?.data || error.message;
      this.logger.error(`Failed to publish photo directly. Error details: ${JSON.stringify(errorDetails)}`);
      
      // Fallback 1: Try without cleaning the URL
      try {
        this.logger.log(`Fallback 1: Trying with original URL: ${imageUrl}`);
        const photoPayload = {
          url: imageUrl,
          caption: postPayload.message,
          access_token: postPayload.access_token,
        };
  
        const photoResponse = await firstValueFrom(
          this.httpService.post(
            `https://graph.facebook.com/v20.0/${pageId}/photos`,
            photoPayload
          )
        );
  
        return photoResponse.data.id;
      } catch (fallback1Error) {
        this.logger.error(`Fallback 1 failed: ${JSON.stringify(fallback1Error.response?.data || fallback1Error.message)}`);
        
        // Fallback 2: Try as a link post with image preview
        try {
          this.logger.log(`Fallback 2: Trying as link post`);
          const linkPostPayload = {
            message: postPayload.message,
            link: imageUrl,
            access_token: postPayload.access_token,
          };
  
          const response = await firstValueFrom(
            this.httpService.post(
              `https://graph.facebook.com/v20.0/${pageId}/feed`,
              linkPostPayload
            )
          );
  
          if (!response.data.id) {
            throw new Error('Failed to get post ID from Facebook response');
          }
  
          return response.data.id;
        } catch (fallback2Error) {
          this.logger.error(`Fallback 2 failed: ${JSON.stringify(fallback2Error.response?.data || fallback2Error.message)}`);
          
          // Fallback 3: Post as text only and mention the image issue
          try {
            this.logger.log(`Fallback 3: Posting as text only`);
            const textOnlyPayload = {
              message: `${postPayload.message}\n\n[Image could not be loaded: ${imageUrl}]`,
              access_token: postPayload.access_token,
            };
  
            const response = await firstValueFrom(
              this.httpService.post(
                `https://graph.facebook.com/v20.0/${pageId}/feed`,
                textOnlyPayload
              )
            );
  
            if (!response.data.id) {
              throw new Error('Failed to get post ID from Facebook response');
            }
  
            this.logger.warn(`Posted as text only due to image upload issues. Post ID: ${response.data.id}`);
            return response.data.id;
          } catch (fallback3Error) {
            const finalError = fallback3Error.response?.data || fallback3Error.message;
            throw new Error(`All fallback methods failed. Final error: ${JSON.stringify(finalError)}`);
          }
        }
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
    } catch (error) {
      this.logger.error(`Failed to get page info: ${error.message}`);
      throw error;
    }
  }
}