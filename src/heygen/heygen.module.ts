import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import * as https from 'https';

import { HeygenService } from './heygen.service';
import { HeygenController } from './heygen.controller';
import { ElevenLabsModule } from 'src/elevenlabs/elevenlabs.module';

@Module({
  imports: [
    HttpModule.register({
      // Longer timeout helps for uploads/generation
      timeout: Number(process.env.HEYGEN_HTTP_TIMEOUT_MS ?? 120000),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      // Keep-alive reduces TLS handshakes on repeated calls
      httpsAgent: new https.Agent({ keepAlive: true }),
      // baseURL not required since we call absolute URLs in the service
    }),
    ElevenLabsModule,
  ],
  controllers: [HeygenController],
  providers: [HeygenService],
  exports: [HeygenService],
})
export class HeygenModule {}
