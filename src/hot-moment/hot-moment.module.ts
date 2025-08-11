import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotMomentService } from './hot-moment.service';
import { HotMomentController } from './hot-moment.controller';
import { HotMoment, HotMomentSchema } from './schemas/hot-moment.schema';
import { HttpModule } from '@nestjs/axios';


@Module({
  imports: [
    MongooseModule.forFeature([{ name: HotMoment.name, schema: HotMomentSchema }]),
    HttpModule,  // Import HttpModule to use HttpService in the controller
  ],
  controllers: [HotMomentController],
  providers: [HotMomentService],
  exports: [
    HotMomentService,
    MongooseModule,  // <-- exporter aussi MongooseModule avec le modèle
  ],
})
export class HotMomentModule {}

