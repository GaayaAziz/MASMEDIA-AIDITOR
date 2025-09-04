    import { Controller, Get, Query, Res, Post, Body, Logger, Param } from '@nestjs/common';
    import { Response } from 'express';
    import axios from 'axios';
    import { InstagramCredentialsService } from '../instagram-credentials/instagram-credentials.service';
    import { InstagramPublishingService } from '../instagram-publishing/instagram-publishing.service';
import { ApiTags } from '@nestjs/swagger';
    interface FbPage {
    id: string;
    name: string;
    username?: string;
    access_token: string;
    category?: string;
    instagram_business_account?: {
        id: string;
    };
    }

    interface InstagramAccount {
    id: string;
    username: string;
    name: string;
    profile_picture_url?: string;
    followers_count?: number;
    account_type?: string;
    }

@ApiTags('auth/instagram')
    @Controller('auth/instagram')
    export class InstagramAuthController {
    private readonly logger = new Logger(InstagramAuthController.name);

    constructor(
        private readonly credentialsService: InstagramCredentialsService,
        private readonly instagramService: InstagramPublishingService,
    ) {}

    @Get()
    async login(@Res() res: Response, @Query('userId') userId: string = 'default') {
        this.logger.log(`Starting Instagram auth for userId: ${userId}`);
        
        const params = new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        redirect_uri: `http://localhost:3006/api/auth/instagram/callback?userId=${userId}`,
        response_type: 'code',
        scope: 'pages_show_list,pages_manage_posts,pages_read_engagement,business_management,instagram_basic,instagram_content_publish',
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
        this.logger.log(`Processing Instagram callback for userId: ${userId}`);
        if (!code) throw new Error('No authorization code received');
    
        // Short-lived token
        const tokenResponse = await axios.get(`https://graph.facebook.com/v20.0/oauth/access_token`, {
          params: {
            client_id: process.env.META_APP_ID!,
            client_secret: process.env.META_APP_SECRET!,
            redirect_uri: `http://localhost:3006/api/auth/instagram/callback?userId=${userId}`,
            code,
          },
        });
        const shortLivedToken = tokenResponse.data.access_token;
    
        // Long-lived user token
        const longLivedTokenResponse = await axios.get(`https://graph.facebook.com/v20.0/oauth/access_token`, {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: process.env.META_APP_ID!,
            client_secret: process.env.META_APP_SECRET!,
            fb_exchange_token: shortLivedToken,
          },
        });
        const longLivedUserToken = longLivedTokenResponse.data.access_token;
        const expiresIn = longLivedTokenResponse.data.expires_in;
    
        // User info
        const userResponse = await axios.get(`https://graph.facebook.com/me`, {
          params: {
            access_token: longLivedUserToken,
            fields: 'id,name,email',
          },
        });
        this.logger.log(`User info: ${JSON.stringify(userResponse.data, null, 2)}`);
    
        // Pages with IG
        const response = await axios.get(`https://graph.facebook.com/me/accounts`, {
          params: {
            access_token: longLivedUserToken,
            fields: 'id,name,username,access_token,category,instagram_business_account{id,username}',
          },
        });
        const pages: FbPage[] = response.data?.data ?? [];
        const pagesWithInstagram = pages.filter(p => p.instagram_business_account?.id);
        if (pagesWithInstagram.length === 0) {
          throw new Error(`No Facebook Pages with connected Instagram Business accounts found.`);
        }
    
        let targetPage = pagesWithInstagram.find(p => p.id === '683011664904560' || p.name === 'MassMedia') ?? pagesWithInstagram[0];
        const pageAccessToken = targetPage.access_token;
        const pageId = targetPage.id;
        const instagramAccountId = targetPage.instagram_business_account!.id;
    
        // IG user details (NO account_type)
        const instagramResponse = await axios.get(`https://graph.facebook.com/v20.0/${instagramAccountId}`, {
          params: {
            access_token: pageAccessToken,
            fields: 'id,username,name,profile_picture_url,followers_count',
          },
        });
        const instagramAccount: InstagramAccount = instagramResponse.data;
    
        // Compute token expiry if Facebook provided it
        let userTokenExpiresAt: Date | null = null;
        if (expiresIn && !isNaN(expiresIn) && expiresIn > 0) {
          userTokenExpiresAt = new Date();
          userTokenExpiresAt.setSeconds(userTokenExpiresAt.getSeconds() + expiresIn);
        }
    
        // Save credentials (default accountType)
        await this.credentialsService.saveCredentials({
          userId,
          instagramAccountId,
          instagramAccessToken: pageAccessToken,
          instagramUsername: instagramAccount.username,
          instagramName: instagramAccount.name,
          pageId,
          pageAccessToken,
          pageName: targetPage.name,
          longLivedUserToken,
          userTokenExpiresAt,
          profilePictureUrl: instagramAccount.profile_picture_url,
          followersCount: instagramAccount.followers_count,
          accountType: 'BUSINESS',
        });
    
        // Verify
        const verifyCredentials = await this.credentialsService.getCredentials(userId);
        if (!verifyCredentials) throw new Error('Failed to verify saved Instagram credentials');
    
        res.json({
          success: true,
          message: 'Instagram authentication successful with long-lived tokens',
          instagramAccountId,
          instagramUsername: instagramAccount.username,
          instagramName: instagramAccount.name,
          pageId,
          pageName: targetPage.name,
          userId,
          tokenType: 'long-lived',
          userTokenExpiresAt,
          pageTokenExpires: 'never',
          credentialsVerified: true,
          instagramAccount,
          availablePages: pagesWithInstagram.map(p => ({
            id: p.id,
            name: p.name,
            category: p.category,
            instagramAccountId: p.instagram_business_account?.id
          }))
        });
    
      } catch (error: any) {
        this.logger.error('Instagram auth error:', error.message);
        res.status(500).json({
          success: false,
          error: 'Error during Instagram login',
          message: error.message,
          details: 'Check server logs for more information'
        });
      }
    }
    


    @Post('create-from-facebook')
    async createFromFacebook(@Body() body: {
      userId: string;
      pageId: string;
      pageAccessToken: string;
      longLivedUserToken?: string;
    }) {
      try {
        const { userId, pageId, pageAccessToken, longLivedUserToken } = body;
    
        this.logger.log(`Creating Instagram credentials from Facebook page for userId: ${userId}`);
        this.logger.log(`Page ID: ${pageId}`);
    
        // Step 1: Get detailed page info with expanded Instagram account fields (NO account_type here)
        let pageResponse;
        try {
          pageResponse = await axios.get(`https://graph.facebook.com/v20.0/${pageId}`, {
            params: {
              access_token: pageAccessToken,
              // REMOVE account_type from the expansion list
              fields: 'id,name,username,category,instagram_business_account{id,username,name,profile_picture_url,followers_count}',
            },
          });
        } catch (pageError: any) {
          this.logger.error(`Failed to get page info: ${pageError.message}`);
          if (pageError.response) {
            this.logger.error(`Page API Error Response: ${JSON.stringify(pageError.response.data, null, 2)}`);
          }
          throw new Error(`Failed to get page information: ${pageError.response?.data?.error?.message || pageError.message}`);
        }
    
        const pageData = pageResponse.data;
        this.logger.log(`Page data: ${JSON.stringify(pageData, null, 2)}`);
        
        if (!pageData.instagram_business_account?.id) {
          const errorMessage = `This Facebook page (${pageData.name}) does not have a connected Instagram Business account.`;
          throw new Error(errorMessage);
        }
    
        const instagramAccountId = pageData.instagram_business_account.id;
    
        // Step 2: Get detailed Instagram account info (NO account_type here)
        let instagramAccount: {
          id: string;
          username: string;
          name?: string;
          profile_picture_url?: string | null;
          followers_count?: number;
        };
        try {
          this.logger.log(`Attempting to get Instagram account details for ID: ${instagramAccountId}`);
          this.logger.log(`Using page access token: ${pageAccessToken.substring(0, 20)}...`);
          
          const instagramResponse = await axios.get(`https://graph.facebook.com/v20.0/${instagramAccountId}`, {
            params: {
              access_token: pageAccessToken,
              // REMOVE account_type here as well
              fields: 'id,username,name,profile_picture_url,followers_count',
            },
          });
        
          instagramAccount = instagramResponse.data;
          this.logger.log(`Instagram account details: ${JSON.stringify(instagramAccount, null, 2)}`);
        } catch (igError: any) {
          this.logger.error(`Failed to get Instagram account details: ${igError.message}`);
          if (igError.response) {
            this.logger.error(`Instagram API Error Response: ${JSON.stringify(igError.response.data, null, 2)}`);
          }
          
          // Fallback to basic data from the page response
          this.logger.log(`Using basic Instagram data from page response instead`);
          instagramAccount = {
            id: pageData.instagram_business_account.id,
            username: pageData.instagram_business_account.username,
            name: pageData.instagram_business_account.name || pageData.name,
            profile_picture_url: null,
            followers_count: 0
          };
        }
    
        // Step 3: (Optional) validate IG media endpoint access
        try {
          await axios.get(`https://graph.facebook.com/v20.0/${instagramAccountId}/media`, {
            params: {
              access_token: pageAccessToken,
              limit: 1,
            },
          });
          this.logger.log('Instagram API access validated successfully');
        } catch (testError: any) {
          this.logger.warn(`Instagram API test failed: ${testError.message}`);
          if (testError.response) {
            this.logger.warn(`Test API Error Response: ${JSON.stringify(testError.response.data, null, 2)}`);
          }
          // Non-fatal
        }
    
        // Step 4: Save Instagram credentials (default accountType to BUSINESS)
        await this.credentialsService.saveCredentials({
          userId,
          instagramAccountId,
          instagramAccessToken: pageAccessToken,
          instagramUsername: instagramAccount.username,
          instagramName: instagramAccount.name || pageData.name,
          pageId,
          pageAccessToken,
          pageName: pageData.name,
          longLivedUserToken: longLivedUserToken || undefined,
          userTokenExpiresAt: null,
          profilePictureUrl: instagramAccount.profile_picture_url || undefined,
          followersCount: instagramAccount.followers_count ?? 0,
          accountType: 'BUSINESS',
        });
    
        this.logger.log(`Instagram credentials created successfully for userId: ${userId}`);
    
        return {
          success: true,
          message: 'Instagram credentials created from Facebook page successfully',
          instagramAccountId,
          instagramUsername: instagramAccount.username,
          instagramName: instagramAccount.name || pageData.name,
          pageId,
          pageName: pageData.name,
          userId,
          credentialsVerified: true,
          accountType: 'BUSINESS',
          followersCount: instagramAccount.followers_count ?? 0,
        };
    
      } catch (error: any) {
        this.logger.error('Error creating Instagram credentials from Facebook:', error.message);
        throw new Error(`Failed to create Instagram credentials: ${error.message}`);
      }
    }
    
    
    // Add this helper method to debug connections
    @Get('debug-connections/:pageId')
    async debugConnections(
        @Param('pageId') pageId: string,
        @Query('accessToken') accessToken: string,
        @Query('userToken') userToken?: string
    ) {
        try {
        const debugInfo: any = {
            pageId,
            timestamp: new Date().toISOString(),
            tests: {}
        };
    
        // Test 1: Basic page info
        try {
            const pageResponse = await axios.get(`https://graph.facebook.com/v20.0/${pageId}`, {
            params: {
                access_token: accessToken,
                fields: 'id,name,username,category,instagram_business_account{id,username,name}',
            },
            });
            debugInfo.tests.pageInfo = {
            success: true,
            data: pageResponse.data
            };
        } catch (error) {
            debugInfo.tests.pageInfo = {
            success: false,
            error: error.response?.data || error.message
            };
        }
    
        // Test 2: Check user accounts if userToken provided
        if (userToken) {
            try {
            const userAccountsResponse = await axios.get(`https://graph.facebook.com/me/accounts`, {
                params: {
                access_token: userToken,
                fields: 'id,name,instagram_business_account{id,username}',
                },
            });
            debugInfo.tests.userAccounts = {
                success: true,
                data: userAccountsResponse.data
            };
            } catch (error) {
            debugInfo.tests.userAccounts = {
                success: false,
                error: error.response?.data || error.message
            };
            }
        }
    
        return {
            success: true,
            debugInfo,
            recommendations: [
            'Ensure Instagram account is converted to Business/Creator account',
            'Connect Instagram account to Facebook Page in Business Manager',
            'Verify Meta App has instagram_basic and instagram_content_publish permissions',
            'Check that the Facebook Page has admin access'
            ]
        };
    
        } catch (error) {
        return {
            success: false,
            error: error.message
        };
        }
    }

    @Get('status')
    async getAuthStatus(@Query('userId') userId: string = 'default') {
        try {
        this.logger.log(`Checking Instagram auth status for userId: ${userId}`);
        
        const credentials = await this.credentialsService.getCredentials(userId);
        
        if (!credentials) {
            return {
            authenticated: false,
            message: 'Not authenticated with Instagram',
            action: 'Please authenticate using /auth/instagram or create from Facebook credentials',
            };
        }

        // Check if Instagram token is still valid
        const isTokenValid = await this.instagramService.validateCredentials(
            credentials.instagramAccountId,
            credentials.instagramAccessToken
        );

        if (!isTokenValid) {
            await this.credentialsService.incrementFailedAttempts(userId);
            return {
            authenticated: false,
            message: 'Instagram credentials are invalid or expired',
            reason: 'Instagram access revoked or app permissions changed',
            action: 'Please re-authenticate using /auth/instagram',
            };
        }

        await this.credentialsService.resetFailedAttempts(userId);

        const isUserTokenExpired = credentials.userTokenExpiresAt && 
            new Date() > credentials.userTokenExpiresAt;

        return {
            authenticated: true,
            instagramAccountId: credentials.instagramAccountId,
            instagramUsername: credentials.instagramUsername,
            instagramName: credentials.instagramName,
            pageId: credentials.pageId,
            pageName: credentials.pageName,
            userId,
            tokenStatus: 'valid',
            userTokenStatus: isUserTokenExpired ? 'expired' : 'valid',
            userTokenExpiresAt: credentials.userTokenExpiresAt,
            lastUsedAt: credentials.lastUsedAt,
            failedAttempts: credentials.failedAttempts,
            followersCount: credentials.followersCount,
            accountType: credentials.accountType,
            note: 'Instagram token never expires, user token expiration doesn\'t affect posting',
        };

        } catch (error) {
        this.logger.error(`Error checking Instagram auth status: ${error.message}`);
        return {
            authenticated: false,
            error: error.message,
        };
        }
    }

    @Post('reconnect')
    async reconnect(@Body() body: { userId?: string; forceReauth?: boolean }) {
      const userId = body?.userId || 'default';
    
      try {
        this.logger.log(`Attempting to reconnect Instagram userId: ${userId}`);
        const credentials = await this.credentialsService.getCredentials(userId);
        if (!credentials) {
          return {
            success: false,
            message: 'No existing Instagram credentials found',
            action: 'Use /auth/instagram to authenticate',
            authUrl: `http://localhost:3006/api/auth/instagram?userId=${userId}`,
          };
        }
    
        if (!body?.forceReauth) {
          const isValid = await this.instagramService.validateCredentials(
            credentials.instagramAccountId,
            credentials.instagramAccessToken
          );
          if (isValid) {
            await this.credentialsService.resetFailedAttempts(userId);
            return {
              success: true,
              message: 'Existing Instagram credentials are still valid',
              instagramAccountId: credentials.instagramAccountId,
              instagramUsername: credentials.instagramUsername,
              action: 'No reconnection needed',
            };
          }
        }
    
        // Try to refresh using stored user token
        if (credentials.longLivedUserToken) {
          this.logger.log('Attempting to refresh Instagram credentials using stored user token...');
          try {
            const pagesResponse = await axios.get(`https://graph.facebook.com/me/accounts`, {
              params: {
                access_token: credentials.longLivedUserToken,
                fields: 'id,name,access_token,instagram_business_account{id,username}',
              },
            });
    
            const pages = pagesResponse.data?.data ?? [];
            const pagesWithInstagram = pages.filter((page: any) => page.instagram_business_account?.id);
    
            const targetPage = pagesWithInstagram.find((p: any) =>
              p.id === credentials.pageId ||
              p.instagram_business_account.id === credentials.instagramAccountId
            ) || pagesWithInstagram[0];
    
            if (targetPage) {
              const instagramResponse = await axios.get(
                `https://graph.facebook.com/v20.0/${targetPage.instagram_business_account.id}`, {
                params: {
                  access_token: targetPage.access_token,
                  // NO account_type
                  fields: 'id,username,name,profile_picture_url,followers_count',
                },
              });
    
              await this.credentialsService.saveCredentials({
                userId,
                instagramAccountId: targetPage.instagram_business_account.id,
                instagramAccessToken: targetPage.access_token,
                instagramUsername: instagramResponse.data.username,
                instagramName: instagramResponse.data.name,
                pageId: targetPage.id,
                pageAccessToken: targetPage.access_token,
                pageName: targetPage.name,
                longLivedUserToken: credentials.longLivedUserToken,
                userTokenExpiresAt: credentials.userTokenExpiresAt,
                profilePictureUrl: instagramResponse.data.profile_picture_url,
                followersCount: instagramResponse.data.followers_count,
                accountType: 'BUSINESS',
              });
    
              return {
                success: true,
                message: 'Instagram credentials refreshed successfully',
                instagramAccountId: targetPage.instagram_business_account.id,
                instagramUsername: instagramResponse.data.username,
                action: 'Instagram token refreshed',
              };
            }
          } catch (err: any) {
            this.logger.error(`Failed to refresh Instagram credentials: ${err?.message}`);
          }
        }
    
        return {
          success: false,
          message: 'Unable to refresh Instagram credentials automatically',
          action: 'Please re-authenticate to get fresh tokens',
          authUrl: `http://localhost:3006/api/auth/instagram?userId=${userId}`,
        };
      } catch (err: any) {
        this.logger.error(`Error during Instagram reconnect: ${err?.message}`);
        return {
          success: false,
          error: err?.message ?? 'Unknown error',
          authUrl: `http://localhost:3006/api/auth/instagram?userId=${userId}`,
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
            message: success ? 'Disconnected from Instagram' : 'No Instagram credentials found to disconnect',
        };
        } catch (error) {
        return {
            success: false,
            error: error.message,
        };
        }
    }

    @Get('debug')
    async debugCredentials(@Query('userId') userId: string = 'default') {
        try {
        const allCredentials = await this.credentialsService.debugGetAllCredentials();
        const userCredentials = await this.credentialsService.getCredentials(userId);
        
        return {
            success: true,
            requestedUserId: userId,
            userCredentials,
            allCredentials: allCredentials.map(cred => ({
            userId: cred.userId,
            instagramAccountId: cred.instagramAccountId,
            instagramUsername: cred.instagramUsername,
            pageId: cred.pageId,
            pageName: cred.pageName,
            isActive: cred.isActive,
            lastUsedAt: cred.lastUsedAt,
            failedAttempts: cred.failedAttempts,
            })),
        };
        } catch (error) {
        return {
            success: false,
            error: error.message,
        };
        }
    }

    @Get('list-users')
    async listUsers() {
        try {
        const allCredentials = await this.credentialsService.debugGetAllCredentials();
        
        const users = await Promise.all(allCredentials.map(async (cred) => {
            const isValid = cred.isActive ? await this.instagramService.validateCredentials(
            cred.instagramAccountId,
            cred.instagramAccessToken
            ) : false;
            
            return {
            userId: cred.userId,
            instagramAccountId: cred.instagramAccountId,
            instagramUsername: cred.instagramUsername,
            isActive: cred.isActive,
            isTokenValid: isValid,
            lastUsedAt: cred.lastUsedAt,
            failedAttempts: cred.failedAttempts,
            followersCount: cred.followersCount,
            accountType: cred.accountType,
            status: isValid ? 'READY' : cred.isActive ? 'NEEDS_REFRESH' : 'INACTIVE'
            };
        }));
        
        const readyUsers = users.filter(u => u.status === 'READY');
        
        return {
            success: true,
            totalUsers: users.length,
            readyUsers: readyUsers.length,
            users,
            recommendation: readyUsers.length > 0 ? 
            `Use userId: "${readyUsers[0].userId}" for immediate Instagram posting` :
            'Create a new permanent user or refresh existing Instagram credentials'
        };
        
        } catch (error) {
        return {
            success: false,
            error: error.message,
        };
        }
    }
    // ADD THIS inside InstagramAuthController

@Get('check-all-pages')
async checkAllPages(@Query('userToken') userToken: string) {
  this.logger.log('Listing pages for provided user token');

  if (!userToken) {
    throw new Error('Query param "userToken" is required');
  }

  try {
    // Ask Facebook which pages this user manages and expand IG link + page tokens
    const resp = await axios.get('https://graph.facebook.com/v20.0/me/accounts', {
      params: {
        access_token: userToken,
        fields: 'id,name,category,access_token,instagram_business_account{id,username}'
      }
    });

    const pages = Array.isArray(resp.data?.data) ? resp.data.data : [];
    const pagesWithIg = pages.filter((p: any) => p.instagram_business_account?.id);

    return {
      success: true,
      totalPages: pages.length,
      pagesWithInstagram: pagesWithIg.length,
      data: pagesWithIg.map((p: any) => ({
        pageId: p.id,
        pageName: p.name,
        category: p.category,
        pageAccessToken: p.access_token,                 // <-- Use this to post
        instagramId: p.instagram_business_account.id,    // <-- ig user id
        instagramUsername: p.instagram_business_account.username
      })),
      note: 'Use pageAccessToken when calling Instagram Graph endpoints.'
    };
  } catch (e: any) {
    this.logger.error(`check-all-pages failed: ${e?.message}`);
    if (e?.response?.data) this.logger.error(JSON.stringify(e.response.data));
    throw new Error(`Failed to fetch pages: ${e?.response?.data?.error?.message || e.message}`);
  }
}

@Post('manual-create-credentials')
async manualCreateCredentials(@Body() body: {
  userId: string;
  instagramAccountId: string;
  instagramAccessToken: string;
  instagramUsername: string;
  instagramName: string;
  pageId: string;
  pageAccessToken: string;
  pageName: string;
  longLivedUserToken?: string;
}) {
  try {
    const {
      userId,
      instagramAccountId,
      instagramAccessToken,
      instagramUsername,
      instagramName,
      pageId,
      pageAccessToken,
      pageName,
      longLivedUserToken
    } = body;

    this.logger.log(`Manually creating Instagram credentials for userId: ${userId}`);

    // Validate required fields
    if (!userId || !instagramAccountId || !instagramAccessToken || !pageId || !pageAccessToken) {
      throw new Error('Missing required fields: userId, instagramAccountId, instagramAccessToken, pageId, pageAccessToken');
    }

    // Test the Instagram credentials work
    const isValid = await this.instagramService.validateCredentials(
      instagramAccountId,
      instagramAccessToken
    );

    if (!isValid) {
      throw new Error('Invalid Instagram credentials provided');
    }

    // Save Instagram credentials
    const savedCredentials = await this.credentialsService.saveCredentials({
      userId,
      instagramAccountId,
      instagramAccessToken,
      instagramUsername,
      instagramName,
      pageId,
      pageAccessToken,
      pageName,
      longLivedUserToken,
      userTokenExpiresAt: null,
      profilePictureUrl: undefined,
      followersCount: 0,
      accountType: 'BUSINESS',
    });

    this.logger.log(`Instagram credentials manually created successfully for userId: ${userId}`);

    return {
      success: true,
      message: 'Instagram credentials created manually',
      instagramAccountId,
      instagramUsername,
      instagramName,
      pageId,
      pageName,
      userId,
      credentialsVerified: true,
      method: 'manual'
    };

  } catch (error) {
    this.logger.error('Error manually creating Instagram credentials:', error.message);
    throw new Error(`Failed to manually create Instagram credentials: ${error.message}`);
  }
}
    }