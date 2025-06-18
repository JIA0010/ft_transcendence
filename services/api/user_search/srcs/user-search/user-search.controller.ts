import { Controller, Get, Put, Param, UseGuards, Request, Body, HttpException, HttpStatus } from '@nestjs/common';
import { UserSearchService } from './user-search.service';
import { FullAuthGuard } from '../auth/full-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('user-search')
export class UserSearchController {
  constructor(private readonly userSearchService: UserSearchService) {}

  // 自分の情報取得（JWTからユーザー名を取得）
  @UseGuards(FullAuthGuard)
  @Get('me')
  async getMyProfile(@Request() req) {
    try {
      const username = req.user.username;
      const userProfile = await this.userSearchService.findUserProfile(username);
      
      return {
        success: true,
        data: {
          username: userProfile.username,
          profileImage: userProfile.profileImage,
          isOnline: userProfile.isOnline,
        },
      };
    } catch (error) {
      if (error.status === 404) {
        // プロフィールが存在しない場合は作成
        const username = req.user.username;
        const newProfile = await this.userSearchService.createOrUpdateUserProfile(username);
        return {
          success: true,
          data: {
            username: newProfile.username,
            profileImage: newProfile.profileImage,
            isOnline: newProfile.isOnline,
          },
        };
      }
      throw new HttpException('Failed to get user profile', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // 特定ユーザーの情報取得
  @UseGuards(FullAuthGuard)
  @Get('profile/:username')
  async getUserProfile(@Param('username') username: string) {
    try {
      const userProfile = await this.userSearchService.findUserProfile(username);
      
      return {
        success: true,
        data: {
          username: userProfile.username,
          profileImage: userProfile.profileImage,
          isOnline: userProfile.isOnline,
        },
      };
    } catch (error) {
      if (error.status === 404) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Failed to get user profile', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // オンライン状態更新
  @UseGuards(FullAuthGuard)
  @Put('status')
  async updateOnlineStatus(@Request() req, @Body() body: { isOnline: boolean }) {
    try {
      // リクエストにユーザー情報が含まれているかチェック
      if (!req.user || !req.user.username) {
        throw new HttpException('User information not found in request', HttpStatus.UNAUTHORIZED);
      }

      const username = req.user.username;
      console.log(`Updating online status for user: ${username} to ${body.isOnline}`);
      
      const userProfile = await this.userSearchService.updateOnlineStatus(username, body.isOnline);
      
      return {
        success: true,
        data: {
          username: userProfile.username,
          profileImage: userProfile.profileImage,
          isOnline: userProfile.isOnline,
        },
      };
    } catch (error) {
      console.error('Error updating online status:', error);
      
      // 認証エラーの場合は401を返す
      if (error instanceof HttpException && error.getStatus() === 401) {
        throw error;
      }
      
      // ユーザーが見つからない場合
      if (error.code === 'P2025' || error.message?.includes('not found')) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }
      
      throw new HttpException('Failed to update online status', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // プロフィール画像更新
  @UseGuards(FullAuthGuard)
  @Put('profile-image')
  async updateProfileImage(@Request() req, @Body() body: { profileImage: string }) {
    try {
      const username = req.user.username;
      const userProfile = await this.userSearchService.updateProfileImage(username, body.profileImage);
      
      return {
        success: true,
        data: {
          username: userProfile.username,
          profileImage: userProfile.profileImage,
          isOnline: userProfile.isOnline,
        },
      };
    } catch (error) {
      throw new HttpException('Failed to update profile image', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
