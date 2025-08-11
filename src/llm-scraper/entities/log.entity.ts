import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ScrapeLogDocument = ScrapeLog & Document;

@Schema({ timestamps: true })
export class ScrapeLog {
  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  sourceName: string;

  @Prop({ required: true })
  status: 'success' | 'failed';

  @Prop()
  error?: string;

  @Prop({ default: 0 })
  postsCreated?: number;
}

export const ScrapeLogSchema = SchemaFactory.createForClass(ScrapeLog);
