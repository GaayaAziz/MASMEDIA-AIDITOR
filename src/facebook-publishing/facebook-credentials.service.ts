import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FacebookCredentials, FacebookCredentialsDocument } from './entities/facebook-credentials.entity';

@Injectable()
export class FacebookCredentialsService {
  constructor(
    @InjectModel(FacebookCredentials.name)
    private credentialsModel: Model<FacebookCredentialsDocument>,
  ) {}

  async saveCredentials(credentialsData: {
    userId: string;
    pageId: string;
    pageAccessToken: string;
    pageName?: string;
    pageUsername?: string;
    expiresAt?: Date;
  }): Promise<FacebookCredentials> {
    const existingCredentials = await this.credentialsModel.findOne({
      userId: credentialsData.userId,
    });

    if (existingCredentials) {
      Object.assign(existingCredentials, credentialsData);
      return existingCredentials.save();
    } else {
      return this.credentialsModel.create(credentialsData);
    }
  }

  async getCredentials(userId: string): Promise<FacebookCredentials | null> {
    return this.credentialsModel.findOne({ userId, isActive: true }).lean();
  }

  async deleteCredentials(userId: string): Promise<boolean> {
    const result = await this.credentialsModel.updateOne(
      { userId },
      { isActive: false }
    );
    return result.modifiedCount > 0;
  }

  async getAllActiveCredentials(): Promise<FacebookCredentials[]> {
    return this.credentialsModel.find({ isActive: true }).lean();
  }
}