import { Body, Controller, Post , Get , Put , Param , Sse , MessageEvent, BadRequestException } from '@nestjs/common';
import { HotMomentService } from './hot-moment.service';
import { AnalyzeParagraphDto } from './dto/analyze-paragraph.dto';
import { FinalizeThreadDto } from './dto/finalize-thread.dto';
import { HttpService } from '@nestjs/axios';
import { PublishPostDto } from './dto/publish-post.dto';
import { Observable, filter, map } from 'rxjs';
import { ApiTags } from '@nestjs/swagger';




@ApiTags('hot-moment')

@Controller('hot-moment')
export class HotMomentController {
  constructor(private readonly hotMomentService: HotMomentService,
    private readonly httpService: HttpService
  ) {}


  @Sse('stream/:threadId')
streamPosts(@Param('threadId') threadId: string): Observable<MessageEvent> {
  return this.hotMomentService.postStream$.pipe(
    filter(ev => ev.threadId === threadId && (ev.type || 'hot-moment') === 'hot-moment'),
    map(ev => ({ data: { type: 'hot-moment', ...ev } }))
  );
}

  @Sse('stream')
  streamAll(): Observable<MessageEvent> {
    return this.hotMomentService.postStream$.pipe(
      filter(ev => (ev.type || 'hot-moment') === 'hot-moment'),
      map(ev => ({ data: { type: 'hot-moment', ...ev } }))
    );
  }

  @Get('')
  getAllHotMoments() {
    return this.hotMomentService.getAllHotMoments();
  }

  // 🔍 Debug: liste les captures (fichiers réels disque) pour un thread
  @Get('captures/:threadId')
  listCaptures(@Param('threadId') threadId: string) {
    return this.hotMomentService.listCaptures(threadId);
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
    // Simple validation d'ObjectId (24 hex chars)
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new BadRequestException('Invalid hot moment id format');
    }
    return this.hotMomentService.getPostsByHotMomentId(id);
  }

  // 2b. Get all posts for a thread (liste résumée)
  @Get('thread/:threadId/posts')
  getPostsForThread(@Param('threadId') threadId: string) {
    return this.hotMomentService.getPostsByThread(threadId);
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
