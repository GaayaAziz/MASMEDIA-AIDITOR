import { Test, TestingModule } from '@nestjs/testing';
import { InstagramCredentialsService } from './instagram-credentials.service';

describe('InstagramCredentialsService', () => {
  let service: InstagramCredentialsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InstagramCredentialsService],
    }).compile();

    service = module.get<InstagramCredentialsService>(InstagramCredentialsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
