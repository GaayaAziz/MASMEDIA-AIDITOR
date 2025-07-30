import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PostDocument = Post & Document;

@Schema({ timestamps: true })
export class Post {
  @Prop({ required: true })
  title: string; // 🆕 The title of the news article
  
  @Prop({ required: false })
  imageUrl?: string;
  
  @Prop({ required: true })
  sourceUrl: string;

  @Prop({ required: true })
  sourceName: string;

  @Prop({
    required: true,
    type: {
      twitter: { type: String },
      instagram: { type: String },
      facebook: { type: String },
      masmedia: { type: String },
    },
  })
  platforms: {
    twitter: string;
    instagram: string;
    facebook: string;
    masmedia: string;
  };
}

export const PostSchema = SchemaFactory.createForClass(Post);