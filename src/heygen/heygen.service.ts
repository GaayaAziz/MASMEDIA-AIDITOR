import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class HeygenService {
  private readonly apiKey = process.env.HEYGEN_API_KEY!;
  constructor(private readonly http: HttpService) {}

  /** 1) Upload a portrait image → talking_photo_id */
  async uploadTalkingPhoto(image: Express.Multer.File) {
    if (!image?.buffer?.length) throw new InternalServerErrorException('Empty image');
    try {
      const { data } = await firstValueFrom(
        this.http.post('https://upload.heygen.com/v1/talking_photo', image.buffer, {
          headers: {
            'X-Api-Key': this.apiKey,
            'Content-Type': image.mimetype || 'image/jpeg',
          },
          timeout: 120000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      );
      // response shape: { data: { talking_photo_id: '...' }, error: null }
      return data;
    } catch (e: any) {
      throw new InternalServerErrorException(
        `HeyGen upload talking photo failed: ${
          e?.response?.data ? JSON.stringify(e.response.data) : e?.message
        }`,
      );
    }
  }

  /** 2) Upload your MP3/WAV → asset_id (if you don't want to host it) */
async uploadAudioAsset(
  file:
    | Express.Multer.File
    | { buffer: Buffer; mimetype?: string; originalname?: string },
) {
  const buffer = file.buffer;
  const mimetype =
    ('mimetype' in file && file.mimetype) ? file.mimetype : 'audio/mpeg';
  if (!buffer?.length) throw new InternalServerErrorException('Empty audio');
  try {
    const { data } = await firstValueFrom(
      this.http.post('https://upload.heygen.com/v1/asset', buffer, {
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': mimetype,            // raw binary upload
          // 'Content-Disposition' not required
        },
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }),
    );

    // Normalize possible shapes:
    // { data: { asset_id } }
    // { data: { id } }
    // { asset_id } or { id }
    const asset_id =
      data?.data?.asset_id ??
      data?.data?.id ??
      data?.asset_id ??
      data?.id ??
      null;

    if (!asset_id) {
      // bubble up the raw payload so we can see what's happening
      throw new InternalServerErrorException(
        `HeyGen upload asset returned unexpected shape: ${JSON.stringify(data)}`
      );
    }

    return { asset_id, raw: data };
  } catch (e: any) {
    throw new InternalServerErrorException(
      `HeyGen upload asset failed: ${
        e?.response?.data ? JSON.stringify(e.response.data) : e?.message
      }`,
    );
  }
}



  /** 3) Generate a video from talking_photo + your audio (asset or URL) */
  async generateFromTalkingPhoto(opts: {
    talkingPhotoId: string;
    audioAssetId?: string;
    audioUrl?: string;
    width?: number;
    height?: number;
    background?: { type: 'color'; value: string } | { type: 'image'; url: string };
  }) {
    const voice =
      opts.audioAssetId
        ? { type: 'audio', audio_asset_id: opts.audioAssetId }
        : { type: 'audio', audio_url: opts.audioUrl };

    const body = {
      video_inputs: [
        {
          character: {
            type: 'talking_photo',
            talking_photo_id: opts.talkingPhotoId,
            // optional: scale / offset / talking_photo_style
          },
          voice,
          ...(opts.background ? { background: opts.background } : {}),
        },
      ],
      dimension: { width: opts.width ?? 1080, height: opts.height ?? 1920 }, // adjust as needed
      // caption: true, // if you want captions (text voice only)
    };

    try {
      const { data } = await firstValueFrom(
        this.http.post('https://api.heygen.com/v2/video/generate', body, {
          headers: { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' },
          timeout: 120000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      );
      // { error: null, data: { video_id: '...' } }
      return data;
    } catch (e: any) {
      throw new InternalServerErrorException(
        `HeyGen generate failed: ${e?.response?.data ? JSON.stringify(e.response.data) : e?.message}`,
      );
    }
  }

  /** 4) Poll video status until completed → video_url */
  async getVideoStatus(videoId: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.get('https://api.heygen.com/v1/video_status.get', {
          headers: { 'X-Api-Key': this.apiKey },
          params: { video_id: videoId },
          timeout: 60000,
        }),
      );
      return data;
    } catch (e: any) {
      throw new InternalServerErrorException(
        `HeyGen status failed: ${e?.response?.data ? JSON.stringify(e.response.data) : e?.message}`,
      );
    }
  }

  async streamVideoToResponse(videoUrl: string, res: import('express').Response) {
  const { data, headers } = await this.http.axiosRef.get(videoUrl, {
    responseType: 'stream',
    timeout: 120000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  res.setHeader('Content-Type', headers['content-type'] || 'video/mp4');
  if (headers['content-length']) res.setHeader('Content-Length', headers['content-length']);
  res.setHeader('Content-Disposition', 'attachment; filename="heygen_video.mp4"');
  await new Promise<void>((resolve, reject) => {
    data.pipe(res);
    data.on('end', () => resolve());
    data.on('error', reject);
  });
}

/** Upload a raw audio buffer (mp3/wav) -> asset_id (for programmatic TTS result) */
  async uploadAudioBuffer(
    buffer: Buffer,
    filename = 'speech.mp3',
    mimetype: string = 'audio/mpeg',
  ) {
    if (!buffer?.length) {
      throw new InternalServerErrorException('Empty audio buffer');
    }
    try {
      const { data } = await firstValueFrom(
        this.http.post('https://upload.heygen.com/v1/asset', buffer, {
          headers: {
            'X-Api-Key': this.apiKey,
            'Content-Type': mimetype,
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
          timeout: 120000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }),
      );
      // { data: { asset_id }, error: null }
      return data;
    } catch (e: any) {
      throw new InternalServerErrorException(
        `HeyGen upload buffer failed: ${
          e?.response?.data ? JSON.stringify(e.response.data) : e?.message
        }`,
      );
    }
  }

}
