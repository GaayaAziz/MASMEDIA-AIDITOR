import { Controller, Get, Query, Res, Post, Body, Logger } from '@nestjs/common';
import { Response } from 'express';
import axios from 'axios';
import { FacebookCredentialsService } from './facebook-credentials.service';
import { FacebookPublishingService } from './facebook-publishing.service';

interface FbPage {
  id: string;
  name: string;
  username?: string;
  access_token: string;
  category?: string;
}
import { ApiTags } from '@nestjs/swagger';

@ApiTags('auth/facebook')
@Controller('auth/facebook')
export class FacebookAuthController {
  private readonly logger = new Logger(FacebookAuthController.name);

  constructor(
    private readonly credentialsService: FacebookCredentialsService,
    private readonly facebookService: FacebookPublishingService,
  ) {}

  @Get()
  async login(@Res() res: Response, @Query('userId') userId: string = 'default') {
    this.logger.log(`Starting Facebook auth for userId: ${userId}`);
    
    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID!,
      redirect_uri: `http://localhost:3006/api/auth/facebook/callback?userId=${userId}`,
      response_type: 'code',
      scope: 'pages_show_list,pages_manage_posts,pages_read_engagement,business_management',
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
      this.logger.log(`Processing callback for userId: ${userId}`);
      
      if (!code) {
        throw new Error('No authorization code received');
      }

      // Step 1: Get short-lived user access token
      const tokenResponse = await axios.get(`https://graph.facebook.com/v20.0/oauth/access_token`, {
        params: {
          client_id: process.env.META_APP_ID!,
          client_secret: process.env.META_APP_SECRET!,
          redirect_uri: `http://localhost:3006/api/auth/facebook/callback?userId=${userId}`,
          code,
        },
      });

      const shortLivedToken = tokenResponse.data.access_token;
      this.logger.log('Got short-lived token');

      // Step 2: Exchange for long-lived user access token
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
      this.logger.log(`Got long-lived token, expires in ${expiresIn} seconds`);

      // Step 3: Debug the user token to verify permissions
      const debugResponse = await axios.get(`https://graph.facebook.com/debug_token`, {
        params: {
          input_token: longLivedUserToken,
          access_token: `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`,
        },
      });

      this.logger.log(`Token debug info: ${JSON.stringify(debugResponse.data, null, 2)}`);

      // Step 4: Get user info to verify token works
      const userResponse = await axios.get(`https://graph.facebook.com/me`, {
        params: {
          access_token: longLivedUserToken,
          fields: 'id,name,email',
        },
      });

      this.logger.log(`User info: ${JSON.stringify(userResponse.data, null, 2)}`);

      // Step 5: Try multiple approaches to get pages
      let pages: FbPage[] = [];
      const approaches = [
        // Approach 1: Standard pages request
        async () => {
          const response = await axios.get(`https://graph.facebook.com/me/accounts`, {
            params: {
              access_token: longLivedUserToken,
              fields: 'id,name,username,access_token,category',
            },
          });
          return response.data?.data ?? [];
        },

        // Approach 2: Try with business_management scope
        async () => {
          const response = await axios.get(`https://graph.facebook.com/me/businesses`, {
            params: {
              access_token: longLivedUserToken,
              fields: 'id,name',
            },
          });
          
          if (response.data?.data?.length > 0) {
            const businessId = response.data.data[0].id;
            this.logger.log(`Found business: ${businessId}`);
            
            const businessPagesResponse = await axios.get(`https://graph.facebook.com/${businessId}/owned_pages`, {
              params: {
                access_token: longLivedUserToken,
                fields: 'id,name,access_token',
              },
            });
            
            return businessPagesResponse.data?.data ?? [];
          }
          return [];
        },

        // Approach 3: Try getting pages with minimal fields
        async () => {
          const response = await axios.get(`https://graph.facebook.com/me/accounts`, {
            params: {
              access_token: longLivedUserToken,
              fields: 'id,name,access_token',
            },
          });
          return response.data?.data ?? [];
        },

        // Approach 4: Try with different API version
        async () => {
          const response = await axios.get(`https://graph.facebook.com/v19.0/me/accounts`, {
            params: {
              access_token: longLivedUserToken,
              fields: 'id,name,access_token',
            },
          });
          return response.data?.data ?? [];
        }
      ];

      // Try each approach until we find pages
      for (let i = 0; i < approaches.length; i++) {
        try {
          this.logger.log(`Trying approach ${i + 1} to get pages...`);
          pages = await approaches[i]();
          
          if (pages.length > 0) {
            this.logger.log(`Approach ${i + 1} succeeded: Found ${pages.length} pages`);
            break;
          } else {
            this.logger.log(`Approach ${i + 1}: No pages found`);
          }
        } catch (error) {
          this.logger.error(`Approach ${i + 1} failed: ${error.message}`);
          if (error.response) {
            this.logger.error(`Error response: ${JSON.stringify(error.response.data, null, 2)}`);
          }
        }
      }

      // If still no pages found, provide detailed error information
      if (pages.length === 0) {
        const errorMessage = `No Facebook Pages found. This can happen if:
1. The user doesn't have admin access to any Facebook Pages
2. The Facebook app needs additional permissions
3. The pages are not accessible via API

User ID: ${userResponse.data.id}
User Name: ${userResponse.data.name}
Token Permissions: ${JSON.stringify(debugResponse.data?.data?.scopes || [])}

To fix this:
1. Make sure the user is an admin of at least one Facebook Page
2. Check that the Facebook app has the correct permissions
3. Try re-authorizing with updated permissions`;

        throw new Error(errorMessage);
      }
      
      // Log all found pages
      this.logger.log(`Found ${pages.length} pages: ${JSON.stringify(pages.map(p => ({id: p.id, name: p.name})), null, 2)}`);

      // Pick the target page
      let page = pages.find(p => p.id === '683011664904560' || p.name === 'MassMedia');
      if (!page) {
        page = pages[0];
        this.logger.log(`MassMedia page not found, using first available page: ${page.name} (${page.id})`);
      } else {
        this.logger.log(`Found target page: ${page.name} (${page.id})`);
      }
      const pageAccessToken = page.access_token;
      const pageId = page.id;

      this.logger.log(`Got page access token for page: ${page.name} (ID: ${pageId})`);

      // Calculate expiration date for the long-lived user token
      let userTokenExpiresAt = null;
      if (expiresIn && !isNaN(expiresIn) && expiresIn > 0) {
        userTokenExpiresAt = new Date();
        userTokenExpiresAt.setSeconds(userTokenExpiresAt.getSeconds() + expiresIn);
        this.logger.log(`User token expires at: ${userTokenExpiresAt}`);
      } else {
        this.logger.log('No valid expiration time provided for user token');
      }

      // Step 6: Save credentials with proper error handling
      const savedCredentials = await this.credentialsService.saveCredentials({
        userId,
        pageId,
        pageAccessToken,
        pageName: page.name,
        pageUsername: page.username,
        longLivedUserToken,
        userTokenExpiresAt,
      });

      this.logger.log(`Credentials saved successfully for userId: ${userId}`);

      // Step 7: Verify credentials were saved correctly
      const verifyCredentials = await this.credentialsService.getCredentials(userId);
      if (!verifyCredentials) {
        throw new Error('Failed to verify saved credentials');
      }

      res.json({
        success: true,
        message: 'Facebook authentication successful with long-lived tokens',
        pageId,
        pageName: page.name,
        userId,
        tokenType: 'long-lived',
        userTokenExpiresAt,
        pageTokenExpires: 'never',
        credentialsVerified: true,
        availablePages: pages.map(p => ({
          id: p.id,
          name: p.name,
          category: p.category
        }))
      });

    } catch (error) {
      this.logger.error('Facebook auth error:', error.message);
      res.status(500).json({
        success: false,
        error: 'Error during Facebook login',
        message: error.message,
        details: 'Check server logs for more information'
      });
    }
  }

  @Get('status')
  async getAuthStatus(@Query('userId') userId: string = 'default') {
    try {
      this.logger.log(`Checking auth status for userId: ${userId}`);
      
      const credentials = await this.credentialsService.getCredentials(userId);
      
      if (!credentials) {
        return {
          authenticated: false,
          message: 'Not authenticated with Facebook',
          action: 'Please authenticate using /auth/facebook',
        };
      }

      // Check if page token is still valid
      const isPageTokenValid = await this.facebookService.validateCredentials(
        credentials.pageId,
        credentials.pageAccessToken
      );

      if (!isPageTokenValid) {
        // Page token is invalid - user needs to re-authenticate
        await this.credentialsService.incrementFailedAttempts(userId);
        return {
          authenticated: false,
          message: 'Facebook credentials are invalid or expired',
          reason: 'Page access revoked or app permissions changed',
          action: 'Please re-authenticate using /auth/facebook',
        };
      }

      // Reset failed attempts on successful validation
      await this.credentialsService.resetFailedAttempts(userId);

      // Check user token expiration (if stored)
      const isUserTokenExpired = credentials.userTokenExpiresAt && 
        new Date() > credentials.userTokenExpiresAt;

      return {
        authenticated: true,
        pageId: credentials.pageId,
        pageName: credentials.pageName,
        userId,
        pageTokenStatus: 'valid',
        userTokenStatus: isUserTokenExpired ? 'expired' : 'valid',
        userTokenExpiresAt: credentials.userTokenExpiresAt,
        lastUsedAt: credentials.lastUsedAt,
        failedAttempts: credentials.failedAttempts,
        note: 'Page token never expires, user token expiration doesn\'t affect posting',
      };

    } catch (error) {
      this.logger.error(`Error checking auth status: ${error.message}`);
      return {
        authenticated: false,
        error: error.message,
      };
    }
  }

  @Post('reconnect')
  async reconnect(@Body() body: { userId?: string; forceReauth?: boolean }) {
    // ⬅️ make userId visible to both try and catch
    const userId = body?.userId || 'default';
  
    try {
      this.logger.log(`Attempting to reconnect userId: ${userId}`);
      
      const credentials = await this.credentialsService.getCredentials(userId);
      
      if (!credentials) {
        return {
          success: false,
          message: 'No existing credentials found',
          action: 'Use /auth/facebook to authenticate',
          authUrl: `http://localhost:3006/api/auth/facebook?userId=${userId}`,
        };
      }
  
      // If force reauth is NOT requested, validate the current page token first
      if (!body?.forceReauth) {
        const isValid = await this.facebookService.validateCredentials(
          credentials.pageId,
          credentials.pageAccessToken
        );
  
        if (isValid) {
          await this.credentialsService.resetFailedAttempts(userId);
          return {
            success: true,
            message: 'Existing credentials are still valid',
            pageId: credentials.pageId,
            pageName: credentials.pageName,
            action: 'No reconnection needed',
          };
        }
      }
  
      // Try to refresh using the stored long-lived user token (even if possibly expired)
      if (credentials.longLivedUserToken) {
        this.logger.log('Attempting to refresh using stored user token...');
  
        try {
          // Validate the user token
          const debugResponse = await axios.get(`https://graph.facebook.com/debug_token`, {
            params: {
              input_token: credentials.longLivedUserToken,
              access_token: `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`,
            },
          });
  
          const tokenData = debugResponse.data?.data;
          const isUserTokenValid = tokenData?.is_valid === true;
  
          this.logger.log(`User token validation result: ${isUserTokenValid}`);
  
          if (isUserTokenValid) {
            // Try multiple approaches to fetch pages
            const approaches = [
              async () => {
                const response = await axios.get(`https://graph.facebook.com/me/accounts`, {
                  params: {
                    access_token: credentials.longLivedUserToken,
                    fields: 'id,name,username,access_token,category',
                  },
                });
                return (response.data?.data ?? []) as FbPage[];
              },
              async () => {
                const response = await axios.get(`https://graph.facebook.com/me/accounts`, {
                  params: {
                    access_token: credentials.longLivedUserToken,
                    fields: 'id,name,access_token',
                  },
                });
                return (response.data?.data ?? []) as FbPage[];
              },
              // Business-owned pages
              async () => {
                const businessResponse = await axios.get(`https://graph.facebook.com/me/businesses`, {
                  params: {
                    access_token: credentials.longLivedUserToken,
                    fields: 'id,name',
                  },
                });
  
                if (businessResponse.data?.data?.length > 0) {
                  const businessId = businessResponse.data.data[0].id;
                  const businessPagesResponse = await axios.get(
                    `https://graph.facebook.com/${businessId}/owned_pages`,
                    {
                      params: {
                        access_token: credentials.longLivedUserToken,
                        fields: 'id,name,access_token',
                      },
                    }
                  );
                  return (businessPagesResponse.data?.data ?? []) as FbPage[];
                }
                return [] as FbPage[];
              },
            ];
  
            let pages: FbPage[] = [];
            let refreshError: any = null;
  
            for (let i = 0; i < approaches.length; i++) {
              try {
                this.logger.log(`Trying refresh approach ${i + 1}...`);
                pages = await approaches[i]();
                if (pages.length > 0) {
                  this.logger.log(
                    `Refresh approach ${i + 1} succeeded: Found ${pages.length} pages`
                  );
                  break;
                }
              } catch (err: any) {
                refreshError = err;
                this.logger.error(
                  `Refresh approach ${i + 1} failed: ${err?.message}`,
                  err?.stack
                );
                if (err?.response?.data) {
                  this.logger.error(`Error details: ${JSON.stringify(err.response.data)}`);
                }
              }
            }
  
            // Pick the page by id, fallback to name, then first
            const page =
              pages.find((p) => p.id === credentials.pageId) ||
              pages.find((p) => p.name === 'MassMedia') ||
              pages[0];
  
            if (page) {
              await this.credentialsService.saveCredentials({
                userId,
                pageId: page.id,
                pageAccessToken: page.access_token,
                pageName: page.name,
                pageUsername: page.username,
                longLivedUserToken: credentials.longLivedUserToken,
                userTokenExpiresAt: credentials.userTokenExpiresAt,
              });
  
              const newTokenValid = await this.facebookService.validateCredentials(
                page.id,
                page.access_token
              );
  
              return {
                success: true,
                message: 'Credentials refreshed successfully',
                pageId: page.id,
                pageName: page.name,
                action: 'Page token refreshed',
                tokenValid: newTokenValid,
                availablePages: pages.map((p) => ({
                  id: p.id,
                  name: p.name,
                  selected: p.id === page.id,
                })),
              };
            } else {
              this.logger.error(
                `No pages found during refresh. Error: ${refreshError?.message}`
              );
            }
          }
        } catch (err: any) {
          this.logger.error(
            `Failed to refresh with user token: ${err?.message}`,
            err?.stack
          );
          if (err?.response?.data) {
            this.logger.error(`Refresh error details: ${JSON.stringify(err.response.data)}`);
          }
        }
      }
  
      // If all refresh attempts failed, provide clear next steps
      return {
        success: false,
        message: 'Unable to refresh credentials automatically',
        action: 'Please re-authenticate to get fresh tokens',
        reason: 'User token expired, permissions revoked, or no pages accessible',
        authUrl: `http://localhost:3006/api/auth/facebook?userId=${userId}`,
        recommendation: 'Click the authUrl to start fresh authentication process',
      };
    } catch (err: any) {
      this.logger.error(`Error during reconnect: ${err?.message}`, err?.stack);
      return {
        success: false,
        error: err?.message ?? 'Unknown error',
        authUrl: `http://localhost:3006/api/auth/facebook?userId=${userId}`,
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

  @Post('reactivate')
  async reactivate(@Body() body: { userId: string }) {
    try {
      const success = await this.credentialsService.reactivateCredentials(body.userId);
      return {
        success,
        message: success ? 'Credentials reactivated' : 'No credentials found',
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
      
      // Check if there are credentials for other userIds that could be used
      const availableCredentials = allCredentials.filter(cred => cred.userId !== userId);
      
      return {
        success: true,
        requestedUserId: userId,
        userCredentials,
        availableCredentials: availableCredentials.map(cred => ({
          userId: cred.userId,
          pageId: cred.pageId,
          pageName: cred.pageName,
          isActive: cred.isActive,
          lastUsedAt: cred.lastUsedAt,
          failedAttempts: cred.failedAttempts,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt,
        })),
        allCredentials: allCredentials.map(cred => ({
          userId: cred.userId,
          pageId: cred.pageId,
          pageName: cred.pageName,
          isActive: cred.isActive,
          lastUsedAt: cred.lastUsedAt,
          failedAttempts: cred.failedAttempts,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt,
        })),
        suggestion: availableCredentials.length > 0 ? 
          `Try using userId: "${availableCredentials[0].userId}" or use /migrate-credentials to move existing credentials to "default"` :
          'No credentials found. Please authenticate first.'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Post('force-reactivate')
  async forceReactivate(@Body() body: { userId: string }) {
    try {
      // Force update using direct MongoDB access
      const result = await this.credentialsService['credentialsModel'].updateOne(
        { userId: body.userId },
        { 
          $set: { 
            isActive: true,
            failedAttempts: 0,
            lastUsedAt: new Date()
          } 
        }
      );
      
      // Verify the update
      const doc = await this.credentialsService['credentialsModel'].findOne({ userId: body.userId });
      
      return {
        success: result.modifiedCount > 0,
        updateResult: result,
        document: doc ? {
          userId: doc.userId,
          pageId: doc.pageId,
          pageName: doc.pageName,
          isActive: doc.isActive,
          lastUsedAt: doc.lastUsedAt,
          failedAttempts: doc.failedAttempts,
        } : null,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // New endpoint to help diagnose page access issues
  @Get('diagnose')
  async diagnosePageAccess(@Query('userId') userId: string = 'default') {
    try {
      const credentials = await this.credentialsService.getCredentials(userId);
      
      if (!credentials || !credentials.longLivedUserToken) {
        return {
          success: false,
          message: 'No user token found for diagnosis',
        };
      }

      // Get user info
      const userResponse = await axios.get(`https://graph.facebook.com/me`, {
        params: {
          access_token: credentials.longLivedUserToken,
          fields: 'id,name,email',
        },
      });

      // Debug token
      const debugResponse = await axios.get(`https://graph.facebook.com/debug_token`, {
        params: {
          input_token: credentials.longLivedUserToken,
          access_token: `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`,
        },
      });

      // Try to get pages with detailed error info
      let pagesError = null;
      let pages = [];
      
      try {
        const pagesResponse = await axios.get(`https://graph.facebook.com/me/accounts`, {
          params: {
            access_token: credentials.longLivedUserToken,
            fields: 'id,name,access_token,category',
          },
        });
        pages = pagesResponse.data?.data ?? [];
      } catch (error) {
        pagesError = {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        };
      }

      return {
        success: true,
        user: userResponse.data,
        tokenDebug: debugResponse.data,
        pages,
        pagesError,
        recommendations: [
          'Ensure the user is an admin of at least one Facebook Page',
          'Check that the Facebook app has pages_show_list permission',
          'Verify the app is not in development mode restrictions',
          'Make sure the page is published and active'
        ]
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  @Post('create-permanent-user')
  async createPermanentUser(@Body() body: { userId: string; displayName?: string }) {
    try {
      const userId = body.userId;
      const displayName = body.displayName || `Permanent User ${userId}`;
      
      this.logger.log(`Creating permanent user: ${userId}`);
      
      // Generate a unique auth URL for this user
      const authUrl = `http://localhost:3006/api/auth/facebook?userId=${userId}`;
      
      return {
        success: true,
        message: `Permanent user '${userId}' setup initiated`,
        userId,
        displayName,
        authUrl,
        instructions: [
          `1. Click the authUrl: ${authUrl}`,
          '2. Complete Facebook authorization in browser',
          '3. User will be permanently connected with long-lived tokens',
          '4. Use this userId for all future API calls'
        ],
        nextStep: 'Click the authUrl to complete authentication'
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
        const isValid = cred.isActive ? await this.facebookService.validateCredentials(
          cred.pageId,
          cred.pageAccessToken
        ) : false;
        
        return {
          userId: cred.userId,
          pageId: cred.pageId,
          pageName: cred.pageName,
          isActive: cred.isActive,
          isTokenValid: isValid,
          lastUsedAt: cred.lastUsedAt,
          failedAttempts: cred.failedAttempts,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt,
          status: isValid ? 'READY' : cred.isActive ? 'NEEDS_REFRESH' : 'INACTIVE'
        };
      }));
      
      const readyUsers = users.filter(u => u.status === 'READY');
      const needsRefresh = users.filter(u => u.status === 'NEEDS_REFRESH');
      const inactiveUsers = users.filter(u => u.status === 'INACTIVE');
      
      return {
        success: true,
        totalUsers: users.length,
        readyUsers: readyUsers.length,
        needsRefresh: needsRefresh.length,
        inactive: inactiveUsers.length,
        users,
        summary: {
          ready: readyUsers,
          needsRefresh,
          inactive: inactiveUsers
        },
        recommendation: readyUsers.length > 0 ? 
          `Use userId: "${readyUsers[0].userId}" for immediate posting` :
          'Create a new permanent user or refresh existing credentials'
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}