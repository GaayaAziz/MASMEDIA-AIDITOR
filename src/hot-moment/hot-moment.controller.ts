import { Body, Controller, Post , Get , Put , Param , Sse , MessageEvent} from '@nestjs/common';
import { HotMomentService } from './hot-moment.service';
import { AnalyzeParagraphDto } from './dto/analyze-paragraph.dto';
import { FinalizeThreadDto } from './dto/finalize-thread.dto';
import { HttpService } from '@nestjs/axios';
import { PublishPostDto } from './dto/publish-post.dto';
import { Observable, filter, map } from 'rxjs';





@Controller('hot-moment')
export class HotMomentController {
  constructor(private readonly hotMomentService: HotMomentService,
    private readonly httpService: HttpService
  ) {}


  @Sse('stream/:threadId')
streamPosts(@Param('threadId') threadId: string): Observable<MessageEvent> {
  return this.hotMomentService.postStream$.pipe(
    filter(data => data.threadId === threadId),
    map(data => ({
      data, // contains: threadId, title, posts, captures
    }))
  );
}


  /** ✅ Crée un thread pour un nouveau live */
  @Post('create-thread')
  async createThread() {
    const threadId = await this.hotMomentService.createThread();
    return { thread_id: threadId };
  }

  /** ✅ Analyse un paragraphe en temps réel */
  @Post('analyze')
  async analyzeParagraph(@Body() body: AnalyzeParagraphDto) {
    const { thread_id, paragraph } = body;
    return this.hotMomentService.analyzeParagraph(thread_id, paragraph);
  }

  /** ✅ Finalise le live et sauvegarde le dernier hot moment */
  @Post('finalize')
  async finalizeThread(@Body() body: FinalizeThreadDto) {
    const { thread_id } = body;
    await this.hotMomentService.finalizeThread(thread_id);
    return { message: `Thread ${thread_id} finalisé et sauvegardé.` };
  }

  @Post('generate-posts')
  async generatePosts(@Body() body: { title: string; content: string }) {
    const { title, content } = body;
    return this.hotMomentService.generateSocialPosts(title, content);
  }
// 1. Get all hot moments by thread ID
  @Get('thread/:threadId')
  getByThreadId(@Param('threadId') threadId: string) {
    return this.hotMomentService.getHotMomentsByThreadId(threadId);
  }

  // 2. Get social posts by hotMomentId
  @Get(':id/posts')
  getPosts(@Param('id') id: string) {
    return this.hotMomentService.getPostsByHotMomentId(id);
  }

  // 3. Update social posts by hotMomentId
  @Put(':id/posts')
  updatePosts(
    @Param('id') id: string,
    @Body() body: { posts: any } // You can type this more strictly if needed
  ) {
    return this.hotMomentService.updatePostsByHotMomentId(id, body.posts);
  }

 @Post('publish')
async publishToN8n(@Body() body: PublishPostDto) {
  const formattedPosts = body.posts.map(post => ({
    platform: post.platform,
    text: post.text,
    imageUrl: body.selectedImage, // attach selected image to all platforms
  }));

  await this.httpService
    .post('http://localhost:5678/webhook/publish', { posts: formattedPosts })
    .toPromise();

  return { status: 'ok' };
}

}
