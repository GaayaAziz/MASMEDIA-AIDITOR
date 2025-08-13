// dto/publish-post.dto.ts
export class PublishPostDto {
  selectedImage: string; // image or gif (local or URL)
  posts: {
    platform: 'twitter' | 'facebook' | 'instagram' | 'masmedia';
    text: string;
  }[];
}
