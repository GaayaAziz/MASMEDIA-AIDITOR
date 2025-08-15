import { Controller, Get, Query, Res, Post, Body } from '@nestjs/common';
import { Response } from 'express';
import axios from 'axios';
import { FacebookCredentialsService } from './facebook-credentials.service';
import { FacebookPublishingService } from './facebook-publishing.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
@ApiTags('auth/facebook')
@Controller('auth/facebook')
export class FacebookAuthController {
  constructor(
    private readonly credentialsService: FacebookCredentialsService,
    private readonly facebookService: FacebookPublishingService,
  ) {}

  @Get()
  async login(@Res() res: Response, @Query('userId') userId: string = 'default') {
    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID!,
      redirect_uri: `http://localhost:3006/api/auth/facebook/callback?userId=${userId}`,
      response_type: 'code',
      scope: 'pages_show_list,pages_manage_posts,pages_read_engagement',
    });

    res.redirect(`https://www.facebook.com/v20.0/dialog/oauth?${params.toString()}`);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('userId') userId: string = 'default',
    @Res() res: Response
  ) {
    try {
      if (!code) {
        throw new Error('No authorization code received');
      }

      const tokenResponse = await axios.get(`https://graph.facebook.com/v20.0/oauth/access_token`, {
        params: {
          client_id: process.env.META_APP_ID!,
          client_secret: process.env.META_APP_SECRET!,
          redirect_uri: `http://localhost:3006/api/auth/facebook/callback?userId=${userId}`,
          code,
        },
      });

      const userToken = tokenResponse.data.access_token;

      const pagesResponse = await axios.get(`https://graph.facebook.com/me/accounts`, {
        params: {
          access_token: userToken,
          fields: 'id,name,username,access_token',
        },
      });

      const pages = pagesResponse.data.data;
      if (!pages.length) {
        throw new Error('No Pages found for this user.');
      }

      const page = pages[0];
      const pageAccessToken = page.access_token;
      const pageId = page.id;

      await this.credentialsService.saveCredentials({
        userId,
        pageId,
        pageAccessToken,
        pageName: page.name,
        pageUsername: page.username,
      });

      res.json({
        success: true,
        message: 'Facebook authentication successful',
        pageId,
        pageName: page.name,
        userId,
      });

    } catch (error) {
      console.error('Facebook auth error:', error);
      res.status(500).json({
        success: false,
        error: 'Error during Facebook login',
        message: error.message,
      });
    }
  }

  @Get('status')
  async getAuthStatus(@Query('userId') userId: string = 'default') {
    try {
      const credentials = await this.credentialsService.getCredentials(userId);
      
      if (!credentials) {
        return {
          authenticated: false,
          message: 'Not authenticated with Facebook',
        };
      }

      const isValid = await this.facebookService.validateCredentials(
        credentials.pageId,
        credentials.pageAccessToken
      );

      if (!isValid) {
        await this.credentialsService.deleteCredentials(userId);
        return {
          authenticated: false,
          message: 'Facebook credentials are invalid or expired',
        };
      }

      return {
        authenticated: true,
        pageId: credentials.pageId,
        pageName: credentials.pageName,
        userId,
      };

    } catch (error) {
      return {
        authenticated: false,
        error: error.message,
      };
    }
  }

  @Post('disconnect')
  async disconnect(@Body() body: { userId?: string }) {
    try {
      const userId = body.userId || 'default';
      const success = await this.credentialsService.deleteCredentials(userId);
      
      return {
        success,
        message: success ? 'Disconnected from Facebook' : 'No credentials found to disconnect',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}