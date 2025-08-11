import { Test, TestingModule } from '@nestjs/testing';
import { LlmScraperController } from './llm-scraper.controller';

describe('LlmScraperController', () => {
  let controller: LlmScraperController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LlmScraperController],
    }).compile();

    controller = module.get<LlmScraperController>(LlmScraperController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
