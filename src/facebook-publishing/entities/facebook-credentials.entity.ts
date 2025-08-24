import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ 
  timestamps: true,
  collection: 'facebookcredentials' 
})
export class FacebookCredentials {
  @Prop({ required: true, index: true })
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
  longLivedUserToken?: string;

  @Prop({ 
    type: Date,
    default: null,
    validate: {
      validator: function(v: any) {
        // Allow null/undefined or valid Date objects
        return v === null || v === undefined || (v instanceof Date && !isNaN(v.getTime()));
      },
      message: 'userTokenExpiresAt must be a valid Date or null'
    }
  })
  userTokenExpiresAt?: Date | null;

  @Prop({ default: true })
  isActive: boolean;

  // Optional: Track when credentials were last successfully used
  @Prop()
  lastUsedAt?: Date;

  // Optional: Track failed attempts
  @Prop({ default: 0 })
  failedAttempts?: number;
}

export type FacebookCredentialsDocument = FacebookCredentials & Document;
export const FacebookCredentialsSchema = SchemaFactory.createForClass(FacebookCredentials);