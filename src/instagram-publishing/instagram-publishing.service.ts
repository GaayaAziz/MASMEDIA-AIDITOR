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
  useCloudUpload?: boolean;
}): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    const { caption, imageUrl, instagramAccountId, accessToken, useCloudUpload = false } = postData;

    if (!imageUrl) {
      return {
        success: false,
        error: 'Instagram requires an image. Text-only posts are not supported.'
      };
    }

    // Validate caption length (Instagram limit is 2200 characters)
    if (caption.length > 2200) {
      this.logger.warn(`Caption too long (${caption.length} chars), truncating to 2200`);
      postData.caption = caption.substring(0, 2197) + '...';
    }

    // Check image URL accessibility before proceeding
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(imageUrl);
    
    if (isLocalhost && !useCloudUpload) {
      return {
        success: false,
        error: 'Instagram cannot access localhost URLs. Please set useCloudUpload=true to upload via cloud service.'
      };
    }

    // Step 1: Create media object
    const mediaId = useCloudUpload 
      ? await this.createMediaObjectWithCloudUpload(instagramAccountId, imageUrl, postData.caption, accessToken)
      : await this.createMediaObject(instagramAccountId, imageUrl, postData.caption, accessToken);

    // Step 2: Publish the media
    const postId = await this.publishMedia(instagramAccountId, mediaId, accessToken);

    this.logger.log(`Successfully published post to Instagram. Post ID: ${postId}`);
    return { success: true, postId };

  } catch (error) {
    this.logger.error(`Failed to publish to Instagram: ${error.message}`);
    return { success: false, error: error.message };
  }
}

private buildWeservUrl(
  originalUrl: string,
  mode: 'square' | 'portrait' | 'landscape' = 'square'
): string {
  // Remove protocol from URL
  const noProto = originalUrl.replace(/^https?:\/\//i, '');
  
  // Define dimensions and parameters based on mode
  let params: string;
  switch (mode) {
    case 'portrait':
      params = 'w=1080&h=1350&fit=contain&bg=white&output=jpg&q=85';
      break;
    case 'landscape':
      params = 'w=1080&h=566&fit=contain&bg=white&output=jpg&q=85';
      break;
    default: // square
      params = 'w=1080&h=1080&fit=contain&bg=white&output=jpg&q=85';
      break;
  }

  return `https://images.weserv.nl/?url=${encodeURIComponent(noProto)}&${params}`;
}
  // Updated createMediaObject method
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

  // Check if it's a localhost URL
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(imageUrl);
  
  if (isLocalhost) {
    this.logger.error(`Instagram cannot access localhost URLs directly. Image URL: ${imageUrl}`);
    throw new Error(`Instagram requires publicly accessible image URLs. Localhost images cannot be published to Instagram. Please use a publicly accessible image URL or upload the image to a cloud service first.`);
  }

  // For public URLs - try original first
  try {
    this.logger.log(`Creating IG media with original image (no crop): ${imageUrl}`);
    return await tryCreate(imageUrl);
  } catch (error: any) {
    this.logger.error(`Original URL failed:`, error.response?.data);
    
    if (this.isAspectRatioError(error)) {
      this.logger.warn(`Original image rejected for aspect ratio. Retrying with padded IG-safe URLs...`);

      // Try multiple fallback strategies
      const fallbackUrls = [
        { name: 'square', url: this.buildIgSafeUrl(imageUrl, 'square') },
        { name: 'landscape', url: this.buildIgSafeUrl(imageUrl, 'landscape') },
        { name: 'portrait', url: this.buildIgSafeUrl(imageUrl, 'portrait') },
        // Add weserv.nl fallbacks as additional options
        { name: 'weserv-square', url: this.buildWeservUrl(imageUrl, 'square') },
        { name: 'weserv-landscape', url: this.buildWeservUrl(imageUrl, 'landscape') }
      ];

      let lastError: any;
      for (const fallback of fallbackUrls) {
        try {
          this.logger.log(`Retry (${fallback.name}): ${fallback.url}`);
          return await tryCreate(fallback.url);
        } catch (err: any) {
          this.logger.warn(`${fallback.name} fallback failed: ${err.response?.data?.error?.message || err.message}`);
          lastError = err;
          // Add small delay between retries
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // If all fallbacks fail, throw the last error
      throw new Error(`All aspect ratio fallbacks failed. Last error: ${lastError?.response?.data?.error?.message || lastError?.message}`);
    }

    // For non-aspect ratio errors, try one fallback
    this.logger.warn(`Create media failed (non-aspect issue). Trying square padded once...`);
    try {
      const padded = this.buildIgSafeUrl(imageUrl, 'square');
      return await tryCreate(padded);
    } catch (fallbackError: any) {
      // Try weserv as final fallback
      const weservUrl = this.buildWeservUrl(imageUrl, 'square');
      this.logger.log(`Final fallback attempt with weserv: ${weservUrl}`);
      return await tryCreate(weservUrl);
    }
  }
}

 private async processImageBuffer(buffer: Buffer): Promise<Buffer> {
  // Basic validation
  if (buffer.length === 0) {
    throw new Error('Image buffer is empty');
  }
  
  // Check if buffer is too large (Instagram has limits)
  if (buffer.length > 8 * 1024 * 1024) {
    this.logger.warn(`Image too large (${buffer.length} bytes), needs compression`);
    // For production, you might want to add image compression here using sharp
    // For now, we'll try to proceed as Instagram might still accept it
  }
  
  // Validate image format
  const contentType = this.getImageContentType(buffer);
  
  // For JPEG, ensure proper structure
  if (contentType === 'image/jpeg') {
    // Check SOI (Start of Image) marker
    if (buffer.length < 2 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
      throw new Error('Invalid JPEG: missing SOI marker');
    }
    
    // Check for EOI (End of Image) marker - warn but don't fail
    if (buffer.length >= 2) {
      const lastTwo = buffer.subarray(buffer.length - 2);
      if (lastTwo[0] !== 0xFF || lastTwo[1] !== 0xD9) {
        this.logger.warn('JPEG missing EOI marker, but proceeding');
      }
    }
  }
  
  // For PNG, validate signature
  if (contentType === 'image/png') {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngSignature)) {
      throw new Error('Invalid PNG: incorrect signature');
    }
  }
  
  this.logger.log(`Image validation passed: ${contentType}, size: ${buffer.length} bytes`);
  return buffer;
}

private getImageContentType(buffer: Buffer): string {
  if (buffer.length < 4) return 'image/jpeg'; // fallback
  
  // Check for image signatures
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }
  if (buffer.length > 11 && 
      buffer[8] === 0x57 && buffer[9] === 0x45 && 
      buffer[10] === 0x42 && buffer[11] === 0x50) {
    return 'image/webp';
  }
  
  return 'image/jpeg'; // fallback
}

private ensureProperFilename(filename: string, contentType: string): string {
  const baseName = filename.replace(/\.[^/.]+$/, ''); // remove existing extension
  
  switch (contentType) {
    case 'image/png':
      return `${baseName}.png`;
    case 'image/gif':
      return `${baseName}.gif`;
    case 'image/webp':
      return `${baseName}.webp`;
    case 'image/jpeg':
    default:
      return `${baseName}.jpg`;
  }
}

private validateImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  
  // Check for common image magic bytes
  const jpg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  const gif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
  const webp = buffer.length > 11 && 
    buffer[8] === 0x57 && buffer[9] === 0x45 && 
    buffer[10] === 0x42 && buffer[11] === 0x50;
  
  return jpg || png || gif || webp;
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
  useCloudUpload?: boolean; // New parameter
}): Promise<{ success: boolean; postId?: string; error?: string }> {
  try {
    const { caption, imageUrls, instagramAccountId, accessToken, useCloudUpload = false } = postData;

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
      const mediaId = useCloudUpload
        ? await this.createCarouselMediaObjectWithCloudUpload(instagramAccountId, imageUrl, accessToken)
        : await this.createCarouselMediaObject(instagramAccountId, imageUrl, accessToken);
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


private async uploadToCloudinaryAndGetUrl(buffer: Buffer, filename: string): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary credentials not configured');
  }

  const FormData = require('form-data');
  const crypto = require('crypto');
  
  const timestamp = Math.round(Date.now() / 1000);
  const publicId = `temp_instagram_${timestamp}_${filename.replace(/\.[^/.]+$/, '')}`;
  
  // Create signature
  const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash('sha1')
    .update(paramsToSign + apiSecret)
    .digest('hex');

  const form = new FormData();
  form.append('file', buffer, { filename });
  form.append('api_key', apiKey);
  form.append('timestamp', timestamp);
  form.append('public_id', publicId);
  form.append('signature', signature);

  try {
    this.logger.log(`Uploading ${buffer.length} bytes to Cloudinary...`);
    
    const response = await firstValueFrom(
      this.httpService.post(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        form,
        { 
          headers: form.getHeaders(), 
          timeout: 90000, // Increased timeout to 90 seconds
          maxBodyLength: 50 * 1024 * 1024, // 50MB max body
          maxContentLength: 50 * 1024 * 1024
        }
      )
    );

    if (!response.data?.secure_url) {
      throw new Error('Failed to get secure URL from Cloudinary response');
    }

    this.logger.log(`Successfully uploaded to Cloudinary: ${response.data.secure_url}`);
    return response.data.secure_url;
  } catch (error: any) {
    this.logger.error(`Cloudinary upload failed: ${error.message}`);
    
    // Provide more specific error messages
    if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      throw new Error(`Cloudinary upload timed out. This may be due to a large file or slow connection. File size: ${buffer.length} bytes`);
    }
    
    if (error.response?.data?.error?.message) {
      throw new Error(`Cloudinary error: ${error.response.data.error.message}`);
    }
    
    throw new Error(`Failed to upload image to cloud service: ${error.message}`);
  }
}

private async createCarouselMediaObjectWithCloudUpload(
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

  // Check if it's a localhost URL
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(imageUrl);
  
  if (isLocalhost) {
    try {
      this.logger.log(`Processing localhost carousel image for Instagram: ${imageUrl}`);
      
      // Retry logic for fetching localhost images
      let buffer: Buffer;
      let lastError: any;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          this.logger.log(`Carousel attempt ${attempt}/3 to fetch localhost image: ${imageUrl}`);
          
          const imageResponse = await firstValueFrom(
            this.httpService.get(imageUrl, { 
              responseType: 'arraybuffer',
              timeout: 60000, // Increased timeout
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'image/*,*/*',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
              },
              maxRedirects: 5
            })
          );
          
          buffer = Buffer.from(imageResponse.data);
          this.logger.log(`Successfully fetched carousel image on attempt ${attempt}, size: ${buffer.length} bytes`);
          break;
          
        } catch (fetchError: any) {
          lastError = fetchError;
          this.logger.warn(`Carousel attempt ${attempt}/3 failed: ${fetchError.message}`);
          
          if (attempt < 3) {
            const delay = attempt === 1 ? 2000 : 5000;
            this.logger.log(`Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      if (!buffer!) {
        throw new Error(`Failed to fetch localhost carousel image after 3 attempts. Last error: ${lastError?.message || 'Unknown error'}`);
      }
      
      // Validate and process buffer
      if (buffer.length === 0) {
        throw new Error('Retrieved carousel image buffer is empty');
      }
      
      if (!this.validateImageBuffer(buffer)) {
        throw new Error('Retrieved carousel data is not a valid image file');
      }
      
      const filename = imageUrl.split('/').pop() || 'carousel_image.jpg';
      
      // Upload to cloud service with retry
      let publicUrl: string;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          this.logger.log(`Uploading carousel image to cloud service (attempt ${attempt}/2)...`);
          publicUrl = await this.uploadToCloudinaryAndGetUrl(buffer, filename);
          break;
        } catch (uploadError: any) {
          this.logger.error(`Carousel cloud upload attempt ${attempt} failed: ${uploadError.message}`);
          if (attempt === 2) {
            throw uploadError;
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      // Now use the public URL with Instagram
      return await tryCreate(publicUrl!);
      
    } catch (err: any) {
      this.logger.error(`Localhost carousel image processing failed: ${err.message}`);
      
      // Check if it's a network-related error
      if (err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || 
          err.message.includes('socket hang up') || err.message.includes('timeout') ||
          err.message.includes('ETIMEDOUT') || err.message.includes('ECONNREFUSED')) {
        throw new Error(`Network error accessing localhost carousel image. Please ensure the local server is running and accessible. Error: ${err.message}`);
      }
      
      throw new Error(`Failed to process localhost carousel image for Instagram: ${err.message}`);
    }
  }

  // For public URLs - existing logic with fallback handling
  try {
    this.logger.log(`Creating IG carousel media with original image: ${imageUrl}`);
    return await tryCreate(imageUrl);
  } catch (error: any) {
    this.logger.error(`Carousel original URL failed:`, error.response?.data);
    
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

    const padded = this.buildIgSafeUrl(imageUrl, 'square');
    return await tryCreate(padded);
  }
}


private async createMediaObjectWithCloudUpload(
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

  // Check if it's a localhost URL
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(imageUrl);
  
  if (isLocalhost) {
    try {
      this.logger.log(`Processing localhost image for Instagram: ${imageUrl}`);
      
      let buffer: Buffer;
      let lastError: any;
      let workingUrl = imageUrl;
      
      // Build comprehensive URL list based on your actual static serving configuration
      const urlsToTry: string[] = [imageUrl];
      
      // Extract filename and thread info from the original URL
      const urlParts = imageUrl.split('/');
      const extractedFilename = urlParts.pop();
      const threadFolder = urlParts.find(part => part.startsWith('thread_'));
      
      if (extractedFilename) {
        const baseUrl = 'http://localhost:3001';
        
        // Add alternative URLs based on your static serving setup
        // Your main.ts serves captures directory at /media route
        const alternativeUrls = [
          // Direct filename in media root (maps to captures folder)
          `${baseUrl}/media/${extractedFilename}`,
          // With thread folder structure
          threadFolder ? `${baseUrl}/media/${threadFolder}/${extractedFilename}` : null,
          // Fallback patterns
          `${baseUrl}/captures/${extractedFilename}`,
          threadFolder ? `${baseUrl}/captures/${threadFolder}/${extractedFilename}` : null,
        ];
        
        // Filter out null values and add to urlsToTry
        alternativeUrls.forEach(url => {
          if (url) {
            urlsToTry.push(url);
          }
        });
      }
      
      // Try each URL with retries
      for (let urlIndex = 0; urlIndex < urlsToTry.length; urlIndex++) {
        const currentUrl = urlsToTry[urlIndex];
        let urlWorked = false;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            this.logger.log(`Attempt ${attempt}/3 to fetch localhost image (URL ${urlIndex + 1}): ${currentUrl}`);
            
            const imageResponse = await firstValueFrom(
              this.httpService.get(currentUrl, { 
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  'Accept': 'image/*,*/*',
                  'Cache-Control': 'no-cache',
                  'Connection': 'keep-alive'
                },
                maxRedirects: 5
              })
            );
            
            buffer = Buffer.from(imageResponse.data);
            this.logger.log(`Successfully fetched image on attempt ${attempt} from URL: ${currentUrl}, size: ${buffer.length} bytes`);
            workingUrl = currentUrl;
            urlWorked = true;
            break;
            
          } catch (fetchError: any) {
            lastError = fetchError;
            const status = fetchError.response?.status;
            
            this.logger.warn(`URL ${urlIndex + 1}, Attempt ${attempt}/3 failed: ${fetchError.message} (Status: ${status})`);
            
            // If it's a 404, try next URL instead of retrying same URL
            if (status === 404) {
              break; // Break inner loop, try next URL
            }
            
            if (attempt < 3) {
              const delay = attempt === 1 ? 1000 : 2000;
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        
        if (urlWorked && buffer) {
          break; // Found working URL, exit outer loop
        }
      }
      
      if (!buffer!) {
        throw new Error(`Failed to fetch localhost image after trying all URLs: ${urlsToTry.join(', ')}. Last error: ${lastError?.message}`);
      }
      
      // Process and validate the buffer
      const processedBuffer = await this.processImageBuffer(buffer);
      
      const finalFilename = workingUrl.split('/').pop() || 'image.jpg';
      
      // Upload to cloud service with retry logic
      let publicUrl: string;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          this.logger.log(`Uploading to cloud service (attempt ${attempt}/2)...`);
          publicUrl = await this.uploadToCloudinaryAndGetUrl(processedBuffer, finalFilename);
          break;
        } catch (uploadError: any) {
          this.logger.error(`Cloud upload attempt ${attempt} failed: ${uploadError.message}`);
          if (attempt === 2) {
            throw new Error(`Failed to upload image to cloud service after 2 attempts: ${uploadError.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      // Now use the public URL with Instagram - with retry logic for API calls
      this.logger.log(`Creating Instagram media with Cloudinary URL: ${publicUrl}`);
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await tryCreate(publicUrl!);
        } catch (instagramError: any) {
          this.logger.warn(`Instagram API attempt ${attempt}/3 failed: ${instagramError.message}`);
          
          // Check if it's a network/timeout error
          if (instagramError.code === 'ECONNRESET' || 
              instagramError.code === 'ETIMEDOUT' ||
              instagramError.message?.includes('socket hang up') ||
              instagramError.message?.includes('timeout')) {
            
            if (attempt < 3) {
              const delay = attempt * 2000; // 2s, 4s delays
              this.logger.log(`Network error with Instagram API, retrying in ${delay}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              continue;
            }
          }
          
          // For non-network errors or final attempt, throw immediately
          throw new Error(`Instagram API error: ${instagramError.message}`);
        }
      }
      
    } catch (err: any) {
      this.logger.error(`Failed to process localhost image for Instagram: ${err.message}`);
      
      // More specific error categorization
      if (err.message.includes('Failed to fetch localhost image')) {
        throw new Error(`Image file not accessible: ${err.message}`);
      }
      
      if (err.message.includes('Failed to upload image to cloud service')) {
        throw new Error(`Cloud upload failed: ${err.message}`);
      }
      
      if (err.message.includes('Instagram API error')) {
        throw new Error(`Instagram API error: ${err.message}`);
      }
      
      // Generic fallback
      throw new Error(`Failed to publish localhost image to Instagram: ${err.message}`);
    }
  }

  // For public URLs - existing logic with fallback handling
  try {
    this.logger.log(`Creating IG media with original image (no crop): ${imageUrl}`);
    return await tryCreate(imageUrl);
  } catch (error: any) {
    this.logger.error(`Original URL failed:`, error.response?.data);
    
    if (this.isAspectRatioError(error)) {
      this.logger.warn(`Original image rejected for aspect ratio. Retrying with padded IG-safe URLs...`);

      const fallbackUrls = [
        { name: 'square', url: this.buildIgSafeUrl(imageUrl, 'square') },
        { name: 'landscape', url: this.buildIgSafeUrl(imageUrl, 'landscape') },
        { name: 'portrait', url: this.buildIgSafeUrl(imageUrl, 'portrait') },
        { name: 'weserv-square', url: this.buildWeservUrl(imageUrl, 'square') },
        { name: 'weserv-landscape', url: this.buildWeservUrl(imageUrl, 'landscape') }
      ];

      let lastError: any;
      for (const fallback of fallbackUrls) {
        try {
          this.logger.log(`Retry (${fallback.name}): ${fallback.url}`);
          return await tryCreate(fallback.url);
        } catch (err: any) {
          this.logger.warn(`${fallback.name} fallback failed: ${err.response?.data?.error?.message || err.message}`);
          lastError = err;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      throw new Error(`All aspect ratio fallbacks failed. Last error: ${lastError?.response?.data?.error?.message || lastError?.message}`);
    }

    this.logger.warn(`Create media failed (non-aspect issue). Trying square padded once...`);
    try {
      const padded = this.buildIgSafeUrl(imageUrl, 'square');
      return await tryCreate(padded);
    } catch (fallbackError: any) {
      const weservUrl = this.buildWeservUrl(imageUrl, 'square');
      this.logger.log(`Final fallback attempt with weserv: ${weservUrl}`);
      return await tryCreate(weservUrl);
    }
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

  // Check if it's a localhost URL
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(imageUrl);
  
  if (isLocalhost) {
    this.logger.error(`Instagram cannot access localhost URLs for carousel items. Image URL: ${imageUrl}`);
    throw new Error(`Instagram requires publicly accessible image URLs for carousel items. Localhost images cannot be published to Instagram.`);
  }

  // For public URLs
  try {
    this.logger.log(`Creating IG carousel media with original image: ${imageUrl}`);
    return await tryCreate(imageUrl);
  } catch (error: any) {
    this.logger.error(`Carousel original URL failed:`, error.response?.data);
    
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
    this.logger.log(`Validating Instagram credentials for account ID: ${instagramAccountId}`);
    
    // First, try to get basic account info - REMOVED account_type from fields
    const response = await firstValueFrom(
      this.httpService.get(
        `https://graph.facebook.com/v20.0/${instagramAccountId}?fields=id,username,name&access_token=${accessToken}`,
        {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; InstagramBot/1.0)'
          }
        }
      )
    );

    this.logger.log(`Instagram API response: ${JSON.stringify(response.data)}`);
    
    // Check if the returned account ID matches what we expect
    const isValid = response.data.id === instagramAccountId;
    
    if (isValid) {
      this.logger.log(`✅ Instagram credentials valid for account: ${response.data.username || 'unknown'}`);
    } else {
      this.logger.warn(`❌ Instagram account ID mismatch. Expected: ${instagramAccountId}, Got: ${response.data.id}`);
    }
    
    return isValid;

  } catch (error: any) {
    const errorDetails = error.response?.data?.error || error.response?.data || error.message;
    this.logger.error(`❌ Instagram credentials validation failed: ${JSON.stringify(errorDetails)}`);
    
    // Log specific error details for debugging
    if (error.response?.data?.error) {
      const apiError = error.response.data.error;
      this.logger.error(`Instagram API Error Details:`);
      this.logger.error(`- Code: ${apiError.code}`);
      this.logger.error(`- Type: ${apiError.type}`);
      this.logger.error(`- Message: ${apiError.message}`);
      this.logger.error(`- Subcode: ${apiError.error_subcode || 'N/A'}`);
      
      // Common error codes and their meanings
      switch (apiError.code) {
        case 190:
          this.logger.error('Token expired or invalid');
          break;
        case 100:
          this.logger.error('Invalid parameter or object does not exist');
          break;
        case 200:
          this.logger.error('Permissions error');
          break;
        case 803:
          this.logger.error('Some of the aliases you requested do not exist');
          break;
        default:
          this.logger.error(`Unknown error code: ${apiError.code}`);
      }
    }
    
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
    // More robust Cloudinary transformations
    const tx = mode === 'portrait'
      ? 'c_pad,g_center,b_white,ar_4:5,w_1080,h_1350,f_jpg,q_auto:good'
      : mode === 'landscape'
        ? 'c_pad,g_center,b_white,ar_1.91:1,w_1080,h_566,f_jpg,q_auto:good'
        : 'c_pad,g_center,b_white,ar_1:1,w_1080,h_1080,f_jpg,q_auto:good';

    // Double encode the URL to handle special characters
    const encodedUrl = encodeURIComponent(encodeURIComponent(originalUrl));
    return `https://res.cloudinary.com/${cloudName}/image/fetch/${tx}/${encodedUrl}`;
  }

  // Fallback to weserv
  return this.buildWeservUrl(originalUrl, mode);
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
