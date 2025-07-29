import { Test, TestingModule } from '@nestjs/testing';
import { LlmScraperService } from './llm-scraper.service';

describe('LlmScraperService', () => {
  let service: LlmScraperService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LlmScraperService],
    }).compile();

    service = module.get<LlmScraperService>(LlmScraperService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
