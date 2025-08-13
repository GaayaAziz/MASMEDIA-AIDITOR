import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PostDocument = Post & Document;

@Schema({ timestamps: true })
export class Post {
  @Prop({ required: true })
  title: string;
  
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

  @Prop({
    type: {
      facebook: {
        published: { type: Boolean, default: false },
        publishedAt: { type: Date },
        publishedId: { type: String },
      },
      twitter: {
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
      twitter: { published: false },
      instagram: { published: false },
    },
  })
  publishedTo?: {
    facebook: {
      published: boolean;
      publishedAt?: Date;
      publishedId?: string;
    };
    twitter: {
      published: boolean;
      publishedAt?: Date;
      publishedId?: string;
    };
    instagram: {
      published: boolean;
      publishedAt?: Date;
      publishedId?: string;
    };
  };

  @Prop({ default: false })
  archived?: boolean;

  @Prop()
  tags?: string[];
}

export const PostSchema = SchemaFactory.createForClass(Post);