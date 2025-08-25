import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import { InstagramCredentials, InstagramCredentialsDocument } from '../instagram/entities/instagram-credentials.entity';

@Injectable()
export class InstagramCredentialsService implements OnModuleInit {
  private readonly logger = new Logger(InstagramCredentialsService.name);

  constructor(
    @InjectModel(InstagramCredentials.name)
    private readonly credentialsModel: Model<InstagramCredentialsDocument>,
    @InjectConnection() private readonly connection: Connection
  ) {}

  async onModuleInit() {
    try {
      // Test MongoDB connection on module initialization
      const state = this.connection.readyState;
      const stateMap = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
      };
      
      this.logger.log(`MongoDB connection state: ${stateMap[state] || 'unknown'}`);
      
      if (state === 1) {
        this.logger.log('MongoDB connection successful');
        // Test a simple query
        const count = await this.credentialsModel.countDocuments();
        this.logger.log(`Found ${count} Instagram credentials in database`);
      } else {
        this.logger.error('MongoDB connection not ready');
      }
    } catch (error) {
      this.logger.error(`MongoDB connection test failed: ${error.message}`);
    }
  }

  private normalizeUserId(userId: string): string {
    return userId.toLowerCase().trim();
  }

  private async checkConnection(): Promise<boolean> {
    try {
      if (this.connection.readyState !== 1) {
        this.logger.error('MongoDB not connected');
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`Connection check failed: ${error.message}`);
      return false;
    }
  }

  async saveCredentials(credentialsData: {
    userId: string;
    instagramAccountId: string;
    instagramAccessToken: string;
    instagramUsername?: string;
    instagramName?: string;
    pageId: string;
    pageAccessToken: string;
    pageName?: string;
    longLivedUserToken?: string;
    userTokenExpiresAt?: Date | null;
    profilePictureUrl?: string;
    followersCount?: number;
    accountType?: string;
  }): Promise<InstagramCredentials> {
    try {
      if (!(await this.checkConnection())) {
        throw new Error('Database connection not available');
      }

      const normalizedUserId = this.normalizeUserId(credentialsData.userId);
      this.logger.log(`Saving Instagram credentials for userId: ${normalizedUserId}`);
      
      const existingCredentials = await this.credentialsModel.findOne({
        userId: normalizedUserId,
      }).maxTimeMS(5000); // 5 second timeout
    
      const dataToSave = {
        ...credentialsData,
        userId: normalizedUserId,
        ...(credentialsData.userTokenExpiresAt && 
            credentialsData.userTokenExpiresAt instanceof Date && 
            !isNaN(credentialsData.userTokenExpiresAt.getTime()) 
          ? { userTokenExpiresAt: credentialsData.userTokenExpiresAt } 
          : {})
      };

      if (existingCredentials) {
        Object.assign(existingCredentials, dataToSave);
        existingCredentials.isActive = true;
        existingCredentials.failedAttempts = 0;
        existingCredentials.lastUsedAt = new Date();
        
        const saved = await existingCredentials.save();
        this.logger.log(`Updated existing Instagram credentials for userId: ${normalizedUserId}`);
        return saved;
      } else {
        const newCredentials = new this.credentialsModel({
          ...dataToSave,
          isActive: true,
          failedAttempts: 0,
          lastUsedAt: new Date(),
        });
        
        const saved = await newCredentials.save();
        this.logger.log(`Created new Instagram credentials for userId: ${normalizedUserId}`);
        return saved;
      }
    } catch (error) {
      this.logger.error(`Error saving Instagram credentials: ${error.message}`);
      if (error.message.includes('ETIMEDOUT') || error.message.includes('ENETUNREACH')) {
        throw new Error('Database connection timeout. Please check MongoDB Atlas connection and network access.');
      }
      throw error;
    }
  }

  async getCredentials(userId: string): Promise<InstagramCredentials | null> {
    try {
      if (!(await this.checkConnection())) {
        throw new Error('Database connection not available');
      }

      const normalizedUserId = this.normalizeUserId(userId);
      this.logger.log(`Getting Instagram credentials for userId: ${normalizedUserId}`);
      
      let credentials = await this.credentialsModel.findOne({ 
        userId: normalizedUserId, 
        isActive: true 
      })
      .maxTimeMS(5000) // 5 second timeout
      .lean();

      if (!credentials) {
        this.logger.log(`No active Instagram credentials found for userId: ${normalizedUserId}, checking for inactive ones`);
        
        const inactiveCredentials = await this.credentialsModel.findOne({ 
          userId: normalizedUserId 
        })
        .maxTimeMS(5000)
        .lean();
        
        if (inactiveCredentials) {
          this.logger.log(`Found inactive Instagram credentials for userId: ${normalizedUserId}, reactivating...`);
          
          await this.credentialsModel.updateOne(
            { userId: normalizedUserId },
            { 
              isActive: true,
              failedAttempts: 0,
              lastUsedAt: new Date()
            }
          ).maxTimeMS(5000);
          
          credentials = await this.credentialsModel.findOne({ 
            userId: normalizedUserId, 
            isActive: true 
          })
          .maxTimeMS(5000)
          .lean();
          
          this.logger.log(`Reactivated Instagram credentials for userId: ${normalizedUserId}`);
        }
      }

      if (credentials) {
        await this.credentialsModel.updateOne(
          { userId: normalizedUserId, isActive: true },
          { lastUsedAt: new Date() }
        ).maxTimeMS(5000);
      }

      return credentials;
    } catch (error) {
      this.logger.error(`Error getting Instagram credentials for userId ${userId}: ${error.message}`);
      if (error.message.includes('ETIMEDOUT') || error.message.includes('ENETUNREACH')) {
        throw new Error('Database connection timeout. Please check MongoDB Atlas connection and network access.');
      }
      return null;
    }
  }

  async deleteCredentials(userId: string): Promise<boolean> {
    try {
      if (!(await this.checkConnection())) {
        throw new Error('Database connection not available');
      }

      const normalizedUserId = this.normalizeUserId(userId);
      this.logger.log(`Soft deleting Instagram credentials for userId: ${normalizedUserId}`);
      
      const result = await this.credentialsModel.updateOne(
        { userId: normalizedUserId },
        { isActive: false }
      ).maxTimeMS(5000);
      
      const success = result.modifiedCount > 0;
      this.logger.log(`Soft delete ${success ? 'successful' : 'failed'} for userId: ${normalizedUserId}`);
      
      return success;
    } catch (error) {
      this.logger.error(`Error deleting Instagram credentials: ${error.message}`);
      if (error.message.includes('ETIMEDOUT') || error.message.includes('ENETUNREACH')) {
        throw new Error('Database connection timeout. Please check MongoDB Atlas connection and network access.');
      }
      return false;
    }
  }

  async getAllActiveCredentials(): Promise<InstagramCredentials[]> {
    try {
      if (!(await this.checkConnection())) {
        throw new Error('Database connection not available');
      }

      return await this.credentialsModel.find({ isActive: true })
        .maxTimeMS(5000)
        .lean();
    } catch (error) {
      this.logger.error(`Error getting all active Instagram credentials: ${error.message}`);
      if (error.message.includes('ETIMEDOUT') || error.message.includes('ENETUNREACH')) {
        throw new Error('Database connection timeout. Please check MongoDB Atlas connection and network access.');
      }
      return [];
    }
  }

  async hasValidCredentials(userId: string): Promise<boolean> {
    try {
      const credentials = await this.getCredentials(userId);
      return !!credentials;
    } catch (error) {
      this.logger.error(`Error checking valid Instagram credentials: ${error.message}`);
      return false;
    }
  }

  async updateCredentials(userId: string, updates: Partial<InstagramCredentials>): Promise<boolean> {
    try {
      if (!(await this.checkConnection())) {
        throw new Error('Database connection not available');
      }

      const normalizedUserId = this.normalizeUserId(userId);
      const result = await this.credentialsModel.updateOne(
        { userId: normalizedUserId, isActive: true },
        { 
          ...updates,
          lastUsedAt: new Date()
        }
      ).maxTimeMS(5000);
      
      return result.modifiedCount > 0;
    } catch (error) {
      this.logger.error(`Error updating Instagram credentials: ${error.message}`);
      if (error.message.includes('ETIMEDOUT') || error.message.includes('ENETUNREACH')) {
        throw new Error('Database connection timeout. Please check MongoDB Atlas connection and network access.');
      }
      return false;
    }
  }

  async reactivateCredentials(userId: string): Promise<boolean> {
    try {
      if (!(await this.checkConnection())) {
        throw new Error('Database connection not available');
      }

      const normalizedUserId = this.normalizeUserId(userId);
      this.logger.log(`Attempting to reactivate Instagram credentials for userId: ${normalizedUserId}`);
      
      const result = await this.credentialsModel.updateOne(
        { userId: normalizedUserId },
        { 
          isActive: true,
          failedAttempts: 0,
          lastUsedAt: new Date()
        }
      ).maxTimeMS(5000);
      
      const success = result.modifiedCount > 0;
      this.logger.log(`Instagram reactivation ${success ? 'successful' : 'failed'} for userId: ${normalizedUserId}`);
      
      return success;
    } catch (error) {
      this.logger.error(`Error reactivating Instagram credentials: ${error.message}`);
      if (error.message.includes('ETIMEDOUT') || error.message.includes('ENETUNREACH')) {
        throw new Error('Database connection timeout. Please check MongoDB Atlas connection and network access.');
      }
      return false;
    }
  }

  async incrementFailedAttempts(userId: string): Promise<void> {
    try {
      if (!(await this.checkConnection())) {
        return; // Silently fail for this non-critical operation
      }

      const normalizedUserId = this.normalizeUserId(userId);
      await this.credentialsModel.updateOne(
        { userId: normalizedUserId, isActive: true },
        { 
          $inc: { failedAttempts: 1 },
          lastUsedAt: new Date()
        }
      ).maxTimeMS(5000);
    } catch (error) {
      this.logger.error(`Error incrementing Instagram failed attempts: ${error.message}`);
    }
  }

  async resetFailedAttempts(userId: string): Promise<void> {
    try {
      if (!(await this.checkConnection())) {
        return; // Silently fail for this non-critical operation
      }

      const normalizedUserId = this.normalizeUserId(userId);
      await this.credentialsModel.updateOne(
        { userId: normalizedUserId, isActive: true },
        { 
          failedAttempts: 0,
          lastUsedAt: new Date()
        }
      ).maxTimeMS(5000);
    } catch (error) {
      this.logger.error(`Error resetting Instagram failed attempts: ${error.message}`);
    }
  }

  async debugGetAllCredentials(): Promise<any[]> {
    try {
      if (!(await this.checkConnection())) {
        throw new Error('Database connection not available');
      }

      return await this.credentialsModel.find({})
        .maxTimeMS(5000)
        .lean();
    } catch (error) {
      this.logger.error(`Error getting all Instagram credentials for debug: ${error.message}`);
      if (error.message.includes('ETIMEDOUT') || error.message.includes('ENETUNREACH')) {
        throw new Error('Database connection timeout. Please check MongoDB Atlas connection and network access.');
      }
      return [];
    }
  }

  // Add a health check method
  async healthCheck(): Promise<{ connected: boolean; message: string }> {
    try {
      const isConnected = await this.checkConnection();
      if (!isConnected) {
        return { 
          connected: false, 
          message: 'Database connection not available' 
        };
      }

      // Test with a simple operation
      await this.credentialsModel.countDocuments().maxTimeMS(3000);
      
      return { 
        connected: true, 
        message: 'Database connection healthy' 
      };
    } catch (error) {
      return { 
        connected: false, 
        message: `Database connection error: ${error.message}` 
      };
    }
  }
}