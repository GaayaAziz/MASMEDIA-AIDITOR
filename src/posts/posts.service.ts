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

  async getPostsGroupedByPlatform() {
    const allPosts = await this.getAllPosts(100);
    return {
      twitter: allPosts.filter(p => p.platforms?.twitter),
      instagram: allPosts.filter(p => p.platforms?.instagram),
      masmedia: allPosts.filter(p => p.platforms?.masmedia),
      facebook: allPosts.filter(p => p.platforms?.facebook),
    };
  }
}
