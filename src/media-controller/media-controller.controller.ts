// In your main app.controller.ts or create a new media.controller.ts
import { Controller, Get, Param, Res, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs-extra';

@Controller('media')
export class MediaController {
  private readonly capturesRoot = path.join(process.cwd(), 'captures');

  @Get('*')
  async serveMedia(@Param('0') filePath: string, @Res() res: Response) {
    try {
      const safePath = path.join(this.capturesRoot, filePath);
      
      // Security check - ensure path is within captures directory
      if (!safePath.startsWith(this.capturesRoot)) {
        throw new HttpException('Invalid file path', HttpStatus.FORBIDDEN);
      }

      const exists = await fs.pathExists(safePath);
      if (!exists) {
        throw new HttpException('File not found', HttpStatus.NOT_FOUND);
      }

      const stat = await fs.stat(safePath);
      if (!stat.isFile()) {
        throw new HttpException('Path is not a file', HttpStatus.BAD_REQUEST);
      }

      // Set appropriate content type
      const ext = path.extname(safePath).toLowerCase();
      if (ext === '.jpg' || ext === '.jpeg') {
        res.contentType('image/jpeg');
      } else if (ext === '.png') {
        res.contentType('image/png');
      } else if (ext === '.gif') {
        res.contentType('image/gif');
      } else {
        res.contentType('application/octet-stream');
      }

      // Stream the file
      const stream = fs.createReadStream(safePath);
      stream.pipe(res);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Error serving media file', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}