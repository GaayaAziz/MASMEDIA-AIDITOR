import { Injectable, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { TwitterApi } from 'twitter-api-v2';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

@Injectable()
export class TwitterService {
  private client: TwitterApi;
  private mediaCache = new Map<string, { mediaId: string; ts: number }>();
  private MEDIA_CACHE_TTL_MS = parseInt(process.env.TWITTER_MEDIA_TTL_MS || '2700000', 10); // 45 min default

  constructor() {
    this.client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });
  }

  private isRateLimit(err: any) {
    const code = err?.code || err?.status;
    return code === 429;
  }

  async postTweetWithLocalImage(text: string, imagePath: string) {
    try {
      // 🧠 Resolve full absolute path
      const fullPath = path.resolve(imagePath);
      console.log('Uploading file:', fullPath);

      // 📥 Read image as buffer
      const imageBuffer = fs.readFileSync(fullPath);

      // 🖼️ Get file extension to set MIME type
      const ext = path.extname(fullPath).toLowerCase();
      let mimeType = 'image/jpg'; // default

      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.gif') mimeType = 'image/gif';

      // 🚀 Upload media
      const mediaId = await this.client.v1.uploadMedia(imageBuffer, {
        mimeType,
      });

      // 📝 Post tweet with image
      const tweet = await this.client.v2.tweet({
        text,
        media: { media_ids: [mediaId] },
      });

      return tweet;
    } catch (err) {
      console.error('❌ Twitter post failed:', err);
      throw err;
    }
  }

  /**
   * Post a tweet with one or many images given in a single request body.
   * images can be:
   *  - string (single path or URL)
   *  - string[] (multiple paths or URLs)
   *  - { paths?: string[]; urls?: string[] }
   */
  async postTweetFlexible(body: { text: string; images?: any; paths?: string[]; urls?: string[]; imagePath?: string | string[] }) {
    const { text } = body;
    if (!text) throw new BadRequestException('text is required');

    // Collect raw inputs
    let inputs: string[] = [];
    if (typeof body.images === 'string') inputs = [body.images];
    else if (Array.isArray(body.images)) inputs = body.images;
    if (Array.isArray(body.paths)) inputs = inputs.concat(body.paths);
    if (Array.isArray(body.urls)) inputs = inputs.concat(body.urls);
    if (body.imagePath) {
      if (Array.isArray(body.imagePath)) inputs = inputs.concat(body.imagePath);
      else inputs.push(body.imagePath);
    }

    // Deduplicate
    inputs = [...new Set(inputs.filter(Boolean))];
  if (inputs.length === 0) throw new BadRequestException('At least one image path or URL required');
  // On accepte jusqu'à 6 (4 + 2 via un second tweet)
  if (inputs.length > 6) inputs = inputs.slice(0, 6);

    const mediaIds: string[] = [];
    for (const input of inputs) {
      try {
        let buffer: Buffer;
        let mimeType = 'image/jpeg';
        if (/^https?:\/\//i.test(input)) {
          // Check cache first
          const cached = this.mediaCache.get(input);
          if (cached && Date.now() - cached.ts < this.MEDIA_CACHE_TTL_MS) {
            mediaIds.push(cached.mediaId);
            continue;
          }
          const res = await axios.get(input, { responseType: 'arraybuffer' });
          buffer = Buffer.from(res.data);
          const contentType = res.headers['content-type'];
          if (contentType) mimeType = contentType.split(';')[0];
        } else {
          // Local path
          const fullPath = path.resolve(input);
          buffer = fs.readFileSync(fullPath);
          const ext = path.extname(fullPath).toLowerCase();
          if (ext === '.png') mimeType = 'image/png';
          else if (ext === '.gif') mimeType = 'image/gif';
          else if (ext === '.webp') mimeType = 'image/webp';
        }
        const mediaId = await this.client.v1.uploadMedia(buffer, { mimeType });
        // cache remote only
        if (/^https?:\/\//i.test(input)) {
          this.mediaCache.set(input, { mediaId, ts: Date.now() });
        }
        mediaIds.push(mediaId);
      } catch (e:any) {
        console.error('Image upload failed for', input, e.message);
      }
    }

    if (mediaIds.length === 0) throw new BadRequestException('No valid images uploaded');

    const toTuple = (ids: string[]) => {
      if (ids.length === 1) return [ids[0]] as [string];
      if (ids.length === 2) return [ids[0], ids[1]] as [string, string];
      if (ids.length === 3) return [ids[0], ids[1], ids[2]] as [string, string, string];
      return [ids[0], ids[1], ids[2], ids[3]] as [string, string, string, string];
    };

    const firstBatch = mediaIds.slice(0, 4);
    const secondBatch = mediaIds.slice(4); // 0 à 2 éléments

    let firstTweet: any;
    try {
      firstTweet = await this.client.v2.tweet({
        text,
        media: { media_ids: toTuple(firstBatch) }
      });
    } catch (e: any) {
      if (this.isRateLimit(e)) {
        throw new HttpException({
          message: 'RATE_LIMIT',
          stage: 'first_tweet',
          hint: 'Attendez quelques minutes avant de retenter'
        }, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw e;
    }

    let secondTweet: any = null;
    if (secondBatch.length) {
      // Reply with remaining images (no duplicate text or add suffix)
      try {
        secondTweet = await this.client.v2.tweet({
          text: secondBatch.length === 1 ? '' : '',
          media: { media_ids: toTuple(secondBatch) },
          reply: { in_reply_to_tweet_id: (firstTweet as any).data?.id }
        });
      } catch (e: any) {
        if (this.isRateLimit(e)) {
          return {
            tweets: [firstTweet],
            totalImages: mediaIds.length,
            split: false,
            warning: 'RATE_LIMIT_SECOND_TWEET'
          };
        }
        throw e;
      }
    }

    return {
      tweets: [firstTweet, secondTweet].filter(Boolean),
      totalImages: mediaIds.length,
      split: secondBatch.length > 0,
    };
  }

  /**
   * Post a tweet (possibly split into 2) with ONLY remote image URLs.
   * Expected body shape:
   * { text: string; imagePath: string | string[] }
   * Accepts 1..6 URLs (first tweet up to 4 images, optional reply with remaining 1-2).
   */
  async postTweetWithUrlsOnly(body: { text: string; imagePath: string | string[] }) {
    const { text, imagePath } = body;
    if (!text) throw new BadRequestException('text is required');
    if (!imagePath) throw new BadRequestException('imagePath is required (string or string[])');

    // Normalize to array
    let urls: string[] = Array.isArray(imagePath) ? imagePath : [imagePath];
    // Trim & dedupe
    urls = [...new Set(urls.map(u => (u || '').trim()).filter(Boolean))];
    if (urls.length === 0) throw new BadRequestException('At least one image URL required');
    if (urls.length > 6) urls = urls.slice(0, 6);

    // Validate all are URLs
    const invalid = urls.filter(u => !/^https?:\/\//i.test(u));
    if (invalid.length) {
      throw new BadRequestException('Only HTTP/HTTPS URLs are allowed: ' + invalid.join(', '));
    }

    const mediaIds: string[] = [];
    for (const url of urls) {
      try {
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        let mimeType = res.headers['content-type'];
        if (mimeType) mimeType = mimeType.split(';')[0];
        if (!mimeType) mimeType = 'image/jpeg';
        const buffer = Buffer.from(res.data);
        const mediaId = await this.client.v1.uploadMedia(buffer, { mimeType });
        mediaIds.push(mediaId);
      } catch (e: any) {
        console.error('Image download/upload failed for', url, e.message);
      }
    }

    if (mediaIds.length === 0) throw new BadRequestException('No valid images uploaded');

    const toTuple = (ids: string[]) => {
      if (ids.length === 1) return [ids[0]] as [string];
      if (ids.length === 2) return [ids[0], ids[1]] as [string, string];
      if (ids.length === 3) return [ids[0], ids[1], ids[2]] as [string, string, string];
      return [ids[0], ids[1], ids[2], ids[3]] as [string, string, string, string];
    };

    const firstBatch = mediaIds.slice(0, 4);
    const secondBatch = mediaIds.slice(4);

    let firstTweet: any;
    try {
      firstTweet = await this.client.v2.tweet({
        text,
        media: { media_ids: toTuple(firstBatch) }
      });
    } catch (e: any) {
      if (this.isRateLimit(e)) {
        throw new HttpException({
          message: 'RATE_LIMIT',
          stage: 'first_tweet',
          hint: 'Réduisez la fréquence des publications'
        }, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw e;
    }

    let secondTweet: any = null;
    if (secondBatch.length) {
      try {
        secondTweet = await this.client.v2.tweet({
          text: '',
          media: { media_ids: toTuple(secondBatch) },
          reply: { in_reply_to_tweet_id: (firstTweet as any).data?.id }
        });
      } catch (e: any) {
        if (this.isRateLimit(e)) {
          return {
            tweets: [firstTweet],
            totalImages: mediaIds.length,
            split: false,
            warning: 'RATE_LIMIT_SECOND_TWEET'
          };
        }
        throw e;
      }
    }

    return {
      tweets: [firstTweet, secondTweet].filter(Boolean),
      totalImages: mediaIds.length,
      split: secondBatch.length > 0,
      source: 'urls-only'
    };
  }
}
