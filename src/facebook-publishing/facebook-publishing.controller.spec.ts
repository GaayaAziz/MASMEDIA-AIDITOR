import { Test, TestingModule } from '@nestjs/testing';
import { FacebookPublishingController } from './facebook-publishing.controller';

describe('FacebookPublishingController', () => {
  let controller: FacebookPublishingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FacebookPublishingController],
    }).compile();

    controller = module.get<FacebookPublishingController>(FacebookPublishingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
