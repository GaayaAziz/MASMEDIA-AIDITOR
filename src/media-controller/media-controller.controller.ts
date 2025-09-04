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
      // Handle nested paths like thread_xxx/filename.jpg
      let safePath = path.join(this.capturesRoot, filePath);
      
      // Security check - ensure path is within captures directory
      if (!safePath.startsWith(this.capturesRoot)) {
        throw new HttpException('Invalid file path', HttpStatus.FORBIDDEN);
      }

      let exists = await fs.pathExists(safePath);
      
      // If the direct path doesn't exist, try to find the file by name only
      if (!exists) {
        const filename = path.basename(filePath);
        
        // Search in all subdirectories for the file
        const findFile = async (dir: string, targetFile: string): Promise<string | null> => {
          try {
            const items = await fs.readdir(dir, { withFileTypes: true });
            
            for (const item of items) {
              const itemPath = path.join(dir, item.name);
              
              if (item.isFile() && item.name === targetFile) {
                return itemPath;
              } else if (item.isDirectory()) {
                const found = await findFile(itemPath, targetFile);
                if (found) return found;
              }
            }
          } catch (error) {
            // Ignore errors when searching
          }
          return null;
        };
        
        const foundPath = await findFile(this.capturesRoot, filename);
        if (foundPath) {
          safePath = foundPath;
          exists = true;
        }
      }

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

      // Add cache headers
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days

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