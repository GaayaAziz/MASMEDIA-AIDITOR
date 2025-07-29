  import { Controller, Post, Get, Body, Query } from '@nestjs/common';
  import { LlmScraperService } from './llm-scraper.service';

  @Controller('llm-scraper')
  export class LlmScraperController {
    constructor(private readonly llmScraperService: LlmScraperService) {}

    @Post()
    async runOne(@Body() body: { url: string; sourceName: string }) {
      await this.llmScraperService.processWebsite(body.url, body.sourceName);
      return { message: `Scraped ${body.url}` };
    }

    @Post('bulk')
    async runMany(@Body() body: { sites: { url: string; sourceName: string }[] }) {
      const results = await this.llmScraperService.processBulkWebsites(body.sites);
      return { message: 'Bulk scraping done.', results };
    }

    @Get('logs')
    async getLogs(@Query('limit') limit = 20) {
      const logs = await this.llmScraperService.getRecentLogs(+limit);
      return { logs };
    }
  }
