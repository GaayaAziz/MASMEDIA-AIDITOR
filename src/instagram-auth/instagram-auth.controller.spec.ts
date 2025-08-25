import { Test, TestingModule } from '@nestjs/testing';
import { InstagramAuthController } from './instagram-auth.controller';

describe('InstagramAuthController', () => {
  let controller: InstagramAuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InstagramAuthController],
    }).compile();

    controller = module.get<InstagramAuthController>(InstagramAuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
