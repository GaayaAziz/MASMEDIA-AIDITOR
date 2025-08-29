import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class HotMoment extends Document {
  @Prop({ required: true })
  thread_id: string;

  @Prop({ required: true })
  moment_title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: Object }) 
  posts?: {
    twitter?: string[];
    instagram?: string;
    facebook?: string;
    masmedia?: string;
  };
  @Prop({ type: [{ offset: Number, screenshotPath: String, gifPath: String }] })
  captures?: {
    offset: number;
    screenshotPath: string;
    gifPath: string;
  }[];
  @Prop({
    type: {
      facebook: {
        published: { type: Boolean, default: false },
        publishedAt: { type: Date },
        publishedId: { type: String },
      },
      instagram: {
        published: { type: Boolean, default: false },
        publishedAt: { type: Date },
        publishedId: { type: String },
      },
    },
    default: {
      facebook: { published: false },
      instagram: { published: false },
    },
  })
  publishedTo?: {
    facebook: { published: boolean; publishedAt?: Date; publishedId?: string };
    instagram: { published: boolean; publishedAt?: Date; publishedId?: string };
  };

}

export const HotMomentSchema = SchemaFactory.createForClass(HotMoment);
