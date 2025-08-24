import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FacebookCredentials, FacebookCredentialsDocument } from './entities/facebook-credentials.entity';

@Injectable()
export class FacebookCredentialsService {
  private readonly logger = new Logger(FacebookCredentialsService.name);

  constructor(
    @InjectModel(FacebookCredentials.name)
    private credentialsModel: Model<FacebookCredentialsDocument>,
  ) {}

  // Helper method to normalize userId (convert to lowercase for consistency)
  private normalizeUserId(userId: string): string {
    return userId.toLowerCase().trim();
  }

  async saveCredentials(credentialsData: {
    userId: string;
    pageId: string;
    pageAccessToken: string;
    pageName?: string;
    pageUsername?: string;
    longLivedUserToken?: string;
    userTokenExpiresAt?: Date | null;
  }): Promise<FacebookCredentials> {
    try {
      const normalizedUserId = this.normalizeUserId(credentialsData.userId);
      this.logger.log(`Saving credentials for userId: ${normalizedUserId} (original: ${credentialsData.userId})`);
      
      const existingCredentials = await this.credentialsModel.findOne({
        userId: normalizedUserId,
      });
    
      const dataToSave = {
        ...credentialsData,
        userId: normalizedUserId,
        // Only include userTokenExpiresAt if it's a valid Date
        ...(credentialsData.userTokenExpiresAt && credentialsData.userTokenExpiresAt instanceof Date && !isNaN(credentialsData.userTokenExpiresAt.getTime()) 
          ? { userTokenExpiresAt: credentialsData.userTokenExpiresAt } 
          : {})
      };

      if (existingCredentials) {
        // Update existing credentials
        Object.assign(existingCredentials, dataToSave);
        existingCredentials.isActive = true;
        existingCredentials.failedAttempts = 0; // Reset failed attempts
        existingCredentials.lastUsedAt = new Date();
        
        const saved = await existingCredentials.save();
        this.logger.log(`Updated existing credentials for userId: ${normalizedUserId}`);
        return saved;
      } else {
        // Create new credentials
        const newCredentials = new this.credentialsModel({
          ...dataToSave,
          isActive: true,
          failedAttempts: 0,
          lastUsedAt: new Date(),
        });
        
        const saved = await newCredentials.save();
        this.logger.log(`Created new credentials for userId: ${normalizedUserId}`);
        return saved;
      }
    } catch (error) {
      this.logger.error(`Error saving credentials: ${error.message}`);
      throw error;
    }
  }

  async getCredentials(userId: string): Promise<FacebookCredentials | null> {
    try {
      const normalizedUserId = this.normalizeUserId(userId);
      this.logger.log(`Getting credentials for userId: ${normalizedUserId} (original: ${userId})`);
      
      // First try to get active credentials
      let credentials = await this.credentialsModel.findOne({ 
        userId: normalizedUserId, 
        isActive: true 
      }).lean();

      // If no active credentials found, check if there are any inactive ones
      if (!credentials) {
        this.logger.log(`No active credentials found for userId: ${normalizedUserId}, checking for inactive ones`);
        
        const inactiveCredentials = await this.credentialsModel.findOne({ userId: normalizedUserId }).lean();
        
        if (inactiveCredentials) {
          this.logger.log(`Found inactive credentials for userId: ${normalizedUserId}, reactivating...`);
          
          // Reactivate the credentials
          await this.credentialsModel.updateOne(
            { userId: normalizedUserId },
            { 
              isActive: true,
              failedAttempts: 0,
              lastUsedAt: new Date()
            }
          );
          
          // Fetch the updated credentials
          credentials = await this.credentialsModel.findOne({ 
            userId: normalizedUserId, 
            isActive: true 
          }).lean();
          
          this.logger.log(`Reactivated credentials for userId: ${normalizedUserId}`);
        }
      }

      if (credentials) {
        // Update last used timestamp
        await this.credentialsModel.updateOne(
          { userId: normalizedUserId, isActive: true },
          { lastUsedAt: new Date() }
        );
      }

      return credentials;
    } catch (error) {
      this.logger.error(`Error getting credentials for userId ${userId}: ${error.message}`);
      return null;
    }
  }

  async deleteCredentials(userId: string): Promise<boolean> {
    try {
      const normalizedUserId = this.normalizeUserId(userId);
      this.logger.log(`Soft deleting credentials for userId: ${normalizedUserId}`);
      
      const result = await this.credentialsModel.updateOne(
        { userId: normalizedUserId },
        { 
          isActive: false,
        }
      );
      
      const success = result.modifiedCount > 0;
      this.logger.log(`Soft delete ${success ? 'successful' : 'failed'} for userId: ${normalizedUserId}`);
      
      return success;
    } catch (error) {
      this.logger.error(`Error deleting credentials: ${error.message}`);
      return false;
    }
  }

  async getAllActiveCredentials(): Promise<FacebookCredentials[]> {
    try {
      return await this.credentialsModel.find({ isActive: true }).lean();
    } catch (error) {
      this.logger.error(`Error getting all active credentials: ${error.message}`);
      return [];
    }
  }

  async getCredentialsNeedingAttention(): Promise<FacebookCredentials[]> {
    try {
      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

      return await this.credentialsModel.find({
        isActive: true,
        userTokenExpiresAt: {
          $exists: true,
          $lte: sevenDaysFromNow,
        },
      }).lean();
    } catch (error) {
      this.logger.error(`Error getting credentials needing attention: ${error.message}`);
      return [];
    }
  }

  async hasValidCredentials(userId: string): Promise<boolean> {
    try {
      const credentials = await this.getCredentials(userId);
      return !!credentials;
    } catch (error) {
      this.logger.error(`Error checking valid credentials: ${error.message}`);
      return false;
    }
  }

  async updateCredentials(userId: string, updates: Partial<FacebookCredentials>): Promise<boolean> {
    try {
      const normalizedUserId = this.normalizeUserId(userId);
      const result = await this.credentialsModel.updateOne(
        { userId: normalizedUserId, isActive: true },
        { 
          ...updates,
          lastUsedAt: new Date()
        }
      );
      return result.modifiedCount > 0;
    } catch (error) {
      this.logger.error(`Error updating credentials: ${error.message}`);
      return false;
    }
  }

  async reactivateCredentials(userId: string): Promise<boolean> {
    try {
      const normalizedUserId = this.normalizeUserId(userId);
      this.logger.log(`Attempting to reactivate credentials for userId: ${normalizedUserId}`);
      
      const existingDoc = await this.credentialsModel.findOne({ userId: normalizedUserId }).lean();
      this.logger.log('Found document:', existingDoc ? 'Yes' : 'No');
      
      if (!existingDoc) {
        this.logger.log('No document found with this userId');
        return false;
      }
      
      const result = await this.credentialsModel.updateOne(
        { userId: normalizedUserId },
        { 
          isActive: true,
          failedAttempts: 0,
          lastUsedAt: new Date()
        }
      );
      
      this.logger.log('Update result:', result);
      
      const success = result.modifiedCount > 0;
      this.logger.log(`Reactivation ${success ? 'successful' : 'failed'} for userId: ${normalizedUserId}`);
      
      return success;
    } catch (error) {
      this.logger.error(`Error reactivating credentials: ${error.message}`);
      return false;
    }
  }

  async incrementFailedAttempts(userId: string): Promise<void> {
    try {
      const normalizedUserId = this.normalizeUserId(userId);
      await this.credentialsModel.updateOne(
        { userId: normalizedUserId, isActive: true },
        { 
          $inc: { failedAttempts: 1 },
          lastUsedAt: new Date()
        }
      );
    } catch (error) {
      this.logger.error(`Error incrementing failed attempts: ${error.message}`);
    }
  }

  async resetFailedAttempts(userId: string): Promise<void> {
    try {
      const normalizedUserId = this.normalizeUserId(userId);
      await this.credentialsModel.updateOne(
        { userId: normalizedUserId, isActive: true },
        { 
          failedAttempts: 0,
          lastUsedAt: new Date()
        }
      );
    } catch (error) {
      this.logger.error(`Error resetting failed attempts: ${error.message}`);
    }
  }

  // Debug method to check all credentials in database
  async debugGetAllCredentials(): Promise<any[]> {
    try {
      return await this.credentialsModel.find({}).lean();
    } catch (error) {
      this.logger.error(`Error getting all credentials for debug: ${error.message}`);
      return [];
    }
  }
}