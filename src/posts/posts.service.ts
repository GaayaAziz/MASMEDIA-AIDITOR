import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Post, PostDocument } from './entities/post.entity';
import { Model } from 'mongoose';

@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private postModel: Model<PostDocument>,
  ) {}

  async createPost(post: Partial<Post>) {
    return this.postModel.create(post);
  }

  async getAllPosts(limit = 50) {
    return this.postModel.find().sort({ createdAt: -1 }).limit(limit).lean();
  }

  async getPostById(id: string) {
    return this.postModel.findById(id).lean();
  }

  async updatePost(id: string, updates: Partial<Post>) {
    return this.postModel.findByIdAndUpdate(id, updates, { new: true }).lean();
  }

  async deletePost(id: string) {
    return this.postModel.findByIdAndDelete(id);
  }

  async getPostsGroupedByPlatform() {
    const allPosts = await this.getAllPosts(100);
    return {
      twitter: allPosts.filter(p => p.platforms?.twitter),
      instagram: allPosts.filter(p => p.platforms?.instagram),
      masmedia: allPosts.filter(p => p.platforms?.masmedia),
      facebook: allPosts.filter(p => p.platforms?.facebook),
    };
  }

  async markAsPublished(postId: string, platform: 'facebook' | 'twitter' | 'instagram', publishedId?: string) {
    const updateData: any = {};
    updateData[`publishedTo.${platform}`] = {
      published: true,
      publishedAt: new Date(),
      ...(publishedId && { publishedId }),
    };

    return this.postModel.findByIdAndUpdate(
      postId,
      { $set: updateData },
      { new: true }
    ).lean();
  }

  async getRecentPosts(hours = 24, limit = 50) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.postModel
      .find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async searchPosts(query: string, limit = 20) {
    const searchRegex = new RegExp(query, 'i');
    return this.postModel
      .find({
        $or: [
          { title: searchRegex },
          { sourceName: searchRegex },
          { 'platforms.facebook': searchRegex },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }
}