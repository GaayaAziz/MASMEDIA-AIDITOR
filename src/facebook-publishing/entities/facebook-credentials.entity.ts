import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FacebookCredentialsDocument = FacebookCredentials & Document;

@Schema({ timestamps: true })
export class FacebookCredentials {
  @Prop({ required: true, unique: true })
  userId: string;

  @Prop({ required: true })
  pageId: string;

  @Prop({ required: true })
  pageAccessToken: string;

  @Prop()
  pageName?: string;

  @Prop()
  pageUsername?: string;

  @Prop()
  expiresAt?: Date;

  @Prop({ default: true })
  isActive: boolean;
}

export const FacebookCredentialsSchema = SchemaFactory.createForClass(FacebookCredentials);