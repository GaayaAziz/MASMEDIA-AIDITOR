import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
const youtubedl = require('youtube-dl-exec');

@Injectable()
export class AudioCleanerService {
  async cleanAudioFromYoutube(url: string): Promise<string> {
    const outputDir = path.resolve('outputs');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const rawAudioPath = path.join(outputDir, `raw-${Date.now()}.mp3`);
    const cleanedAudioPath = path.join(outputDir, `cleaned-${Date.now()}.mp3`);

    // ✅ Correct usage of youtube-dl-exec
    await youtubedl(url, {
      extractAudio: true,
      audioFormat: 'mp3',
      output: rawAudioPath,
      preferFreeFormats: true,
  noCheckCertificates: true,
    });

    // Remove silence using ffmpeg
    await new Promise<void>((resolve, reject) => {
      const command = `ffmpeg -i "${rawAudioPath}" -af silenceremove=1:0:-50dB "${cleanedAudioPath}" -y`;
      exec(command, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    return cleanedAudioPath;
  }
}
