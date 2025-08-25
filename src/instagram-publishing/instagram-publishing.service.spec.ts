import { Test, TestingModule } from '@nestjs/testing';
import { InstagramPublishingService } from './instagram-publishing.service';

describe('InstagramPublishingService', () => {
  let service: InstagramPublishingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InstagramPublishingService],
    }).compile();

    service = module.get<InstagramPublishingService>(InstagramPublishingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
