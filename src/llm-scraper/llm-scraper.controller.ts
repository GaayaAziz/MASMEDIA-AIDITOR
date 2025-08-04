import { Controller, Post, Get, Body, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { LlmScraperService } from './llm-scraper.service';

@Controller('llm-scraper')
export class LlmScraperController {
  constructor(private readonly llmScraperService: LlmScraperService) {}

  @Post()
  async runOne(@Body() body: { url: string; sourceName: string }) {
    const posts = await this.llmScraperService.processWebsite(body.url, body.sourceName);
    return { 
      message: `Successfully scraped ${body.url}`,
      postsCreated: posts.length,
      posts: posts
    };
  }    
  
  @Post('bulk')
  async runMany(
    @Body() sites: { url: string; sourceName: string }[],
    @Res() res: Response
  ) {
    if (!Array.isArray(sites)) {
      throw new Error('Invalid body: Expected an array of { url, sourceName }');
    }

    res.setHeader('Content-Type', 'application/json');
    res.write('['); // Start of JSON array

    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      try {
        const posts = await this.llmScraperService.processWebsite(site.url, site.sourceName);
        res.write(
          JSON.stringify({
            url: site.url,
            sourceName: site.sourceName,
            status: 'success',
            posts
          })
        );
      } catch (err) {
        res.write(
          JSON.stringify({
            url: site.url,
            sourceName: site.sourceName,
            status: 'failed',
            error: err.message
          })
        );
      }

      if (i < sites.length - 1) {
        res.write(','); // Add a comma between JSON objects
      }
    }

    res.write(']'); // End of JSON array
    res.end();
  }

    @Get('logs')
    async getLogs(@Query('limit') limit = 20) {
      const logs = await this.llmScraperService.getRecentLogs(+limit);
      return { logs };
    }
  }
