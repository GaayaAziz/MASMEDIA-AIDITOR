import { Test, TestingModule } from '@nestjs/testing';
import { MediaControllerController } from './media-controller.controller';

describe('MediaControllerController', () => {
  let controller: MediaControllerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediaControllerController],
    }).compile();

    controller = module.get<MediaControllerController>(MediaControllerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
