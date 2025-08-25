import { Test, TestingModule } from '@nestjs/testing';
import { InstagramPublishingController } from './instagram-publishing.controller';

describe('InstagramPublishingController', () => {
  let controller: InstagramPublishingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InstagramPublishingController],
    }).compile();

    controller = module.get<InstagramPublishingController>(InstagramPublishingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
