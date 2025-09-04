  import { Controller, Post, Get, Body, Query, Res, Sse } from '@nestjs/common';
  import { Response } from 'express';
  import { LlmScraperService } from './llm-scraper.service';
  import { Observable, map } from 'rxjs';
  import { MessageEvent } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
@ApiTags('llm-scraper')
  @Controller('llm-scraper')
  export class LlmScraperController {
    constructor(private readonly llmScraperService: LlmScraperService) {}

    @Sse('events')
    streamPosts(): Observable<MessageEvent> {
      return this.llmScraperService.getPostStream().pipe(
        map(evt => {
          const base: any = (evt as any)?.data || {};
          if (base.type === 'post') {
            const id = String(base.id || base._id || base.postId || base.sourceUrl || `tmp_${Date.now()}`);
            return { data: { event: 'post', ...base, id, postId: id, _id: id } } as MessageEvent;
          }
          return { data: { event: base.type || 'unknown', ...base } } as MessageEvent;
        })
      );
    }
    @Post()
    runOne(@Body() body: { url: string; sourceName: string }) {
      this.llmScraperService.processWebsite(body.url, body.sourceName);
      return { message: `Scraping started for ${body.url}` };
    }  
    
    @Post('bulk')
    runMany(@Body() sites: { url: string; sourceName: string }[]) {
      this.llmScraperService.processBulkWebsites(sites);
      return { message: `Bulk scraping job launched`, count: sites.length };
    }

      @Get('logs')
      async getLogs(@Query('limit') limit = 20) {
        const logs = await this.llmScraperService.getRecentLogs(+limit);
        return { logs };
      }
    }
