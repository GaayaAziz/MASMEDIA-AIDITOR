import { Test, TestingModule } from '@nestjs/testing';
import { FacebookPublishingService } from './facebook-publishing.service';

describe('FacebookPublishingService', () => {
  let service: FacebookPublishingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FacebookPublishingService],
    }).compile();

    service = module.get<FacebookPublishingService>(FacebookPublishingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
