import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ 
  timestamps: true,
  collection: 'instagramcredentials' 
})
export class InstagramCredentials {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  instagramAccountId: string;

  @Prop({ required: true })
  instagramAccessToken: string;

  @Prop()
  instagramUsername?: string;

  @Prop()
  instagramName?: string;

  @Prop({ required: true })
  pageId: string; // Connected Facebook Page ID

  @Prop({ required: true })
  pageAccessToken: string; // Facebook Page token

  @Prop()
  pageName?: string;

  @Prop()
  longLivedUserToken?: string;

  @Prop({ 
    type: Date,
    default: null,
    validate: {
      validator: function(v: any) {
        return v === null || v === undefined || (v instanceof Date && !isNaN(v.getTime()));
      },
      message: 'userTokenExpiresAt must be a valid Date or null'
    }
  })
  userTokenExpiresAt?: Date | null;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  lastUsedAt?: Date;

  @Prop({ default: 0 })
  failedAttempts?: number;

  // Instagram-specific fields
  @Prop()
  profilePictureUrl?: string;

  @Prop()
  followersCount?: number;

  @Prop({ 
    type: String, 
    enum: ['BUSINESS', 'CREATOR', 'PERSONAL'], 
    default: 'BUSINESS' 
  })
  accountType?: string;
}

export type InstagramCredentialsDocument = InstagramCredentials & Document;
export const InstagramCredentialsSchema = SchemaFactory.createForClass(InstagramCredentials);