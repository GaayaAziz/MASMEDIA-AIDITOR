import { Injectable } from '@nestjs/common';
import { TwitterApi } from 'twitter-api-v2';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TwitterService {
  private client: TwitterApi;

  constructor() {
    this.client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });
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
}
