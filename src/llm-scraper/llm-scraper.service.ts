import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';
import { PostsService } from '../posts/posts.service';
import OpenAI from 'openai';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ScrapeLog, ScrapeLogDocument } from './entities/log.entity';
import { Post } from '../posts/entities/post.entity';

@Injectable()
export class LlmScraperService {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(LlmScraperService.name);

  constructor(
    private http: HttpService,
    private postsService: PostsService,
    @InjectModel(ScrapeLog.name) private logModel: Model<ScrapeLogDocument>,
  ) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  
  async processWebsite(url: string, sourceName: string): Promise<Post[]> {
    const createdPosts: Post[] = [];
    
    try {
      const html = await this.fetchHTML(url);
      const links = await this.extractRelevantLinks(html, url);
  
      for (const link of links) {
        try {
          const articleHtml = await this.fetchHTML(link);
          const articleContent = this.extractText(articleHtml);
          const post = await this.generatePosts(articleContent, link, sourceName);
          const createdPost = await this.postsService.createPost(post);
          createdPosts.push(createdPost);
        } catch (err) {
          this.logger.warn(`Skipping article ${link}: ${err.message}`);
        }
      }
  
      await this.logModel.create({ 
        url, 
        sourceName, 
        status: 'success',
        postsCreated: createdPosts.length 
      });
      
      return createdPosts;
    } catch (err) {
      await this.logModel.create({ url, sourceName, status: 'failed', error: err.message });
      throw err;
    }
  }
  

  async processBulkWebsites(sites: { url: string; sourceName: string }[]) {

    const results = await Promise.allSettled(
      sites.map(site => this.processWebsite(site.url, site.sourceName))
    );

    return sites.map((site, idx) => ({
      url: site.url,
      sourceName: site.sourceName,
      status: results[idx].status === 'fulfilled' ? 'success' : 'failed',
      error: results[idx].status === 'rejected' ? results[idx].reason?.message : undefined,
      posts: results[idx].status === 'fulfilled' ? results[idx].value : [],
      postsCount: results[idx].status === 'fulfilled' ? results[idx].value.length : 0,
    }));

  }



  async getRecentLogs(limit = 20) {
    return this.logModel.find().sort({ createdAt: -1 }).limit(limit).lean();
  }

  private async fetchHTML(url: string): Promise<string> {
    const response = await firstValueFrom(this.http.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }));
    return response.data;
  }

  private extractText(html: string): string {
    const $ = cheerio.load(html);
    $('script, style, img, input, nav, footer').remove();
    return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 4000);
  }

  private async extractRelevantLinks(html: string, baseUrl: string): Promise<string[]> {
    const $ = cheerio.load(html);
    const allLinks = $('a')
      .map((_, el) => $(el).attr('href'))
      .get()
      .filter(href => href && !href.startsWith('#') && !href.startsWith('mailto:'));
  
    const fullLinks = [...new Set(allLinks.map(href =>
      href.startsWith('http') ? href : new URL(href, baseUrl).href
    ))];
  
    const systemPrompt = `
  You are a senior tech journalist assistant.
  
  You will receive a raw list of URLs extracted from a tech website.
  
  🎯 Your task:
  1. Select ONLY links that point to full-length, individual **tech news articles**.
  2. PRIORITIZE:
     - Breaking news
     - AI innovations
     - Product launches from major companies
     - Cybersecurity incidents
     - Regulation or government-related news
  3. AVOID:
     - Minor updates, summaries, roundups
     - Old articles (before current month if datestamped)
     - Navigation links, categories, or author pages
     - Clickbait or opinion posts
  
  🧠 Look for slugs with dates, named products, companies, or strong indicators of relevance.
  
  ✳️ Output strict JSON like:
  {
    "links": [
      "https://example.com/2025/07/29/ai-breakthrough",
      "https://example.com/2025/07/29/meta-announces-glasses"
    ]
  }
  Do not return explanations or markdown. JSON only.
  `.trim();
  
    const userPrompt = `Here is the list of links to evaluate:\n${fullLinks.join('\n')}`;
  
    const res = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });
  
    const json = JSON.parse(res.choices[0].message.content);
    return json.links;
  }
  

  private async generatePosts(content: string, url: string, sourceName: string) {
    const systemPrompt = `
  Tu es un expert en stratégie de contenu pour les réseaux sociaux, spécialisé dans la communication technologique en temps réel.
  
  À partir du titre et du contenu d’un article de presse tech, génère des posts **parfaitement adaptés** à chaque plateforme :
  
  ---
  
  🟦 "twitter" (X)
  - Format THREAD (chaque élément = un tweet dans un tableau)
  - Premier tweet = titre résumant l'article
  - Ton informatif, percutant, engageant
  - Hashtags pertinents, emojis modérés
  - Dernier tweet = call to action ou question
  
  ---
  
  📸 "instagram"
  - Style accessible, aéré, humanisé
  - Emphase sur les bénéfices / insights
  - Utilise des emojis pour le rythme 🧠✨
  - Lignes sautées pour chaque idée
  - Hashtags discrets à la fin
  
  ---
  
  🔵 "facebook"
  - Ton professionnel et contextuel
  - Résume l’article en 4–6 phrases
  - Suscite le partage ou la discussion
  
  ---
  
  📰 "masmedia"
  - Format mini-article HTML structuré
  - <h2> pour le titre principal
  - <p> pour les paragraphes
  - Commence par une mise en contexte rapide
  - Pas de ton promotionnel — rester factuel, journalistique
  
  ---
  
  ✳️ Format attendu (JSON uniquement) :
  {
    "title": "Titre de l'article",
    "twitter": ["tweet1", "tweet2", "..."],
    "instagram": "...",
    "facebook": "...",
    "masmedia": "..."
  }
  
  Ne retourne **que du JSON brut** (sans balises \`\`\`, ni commentaires, ni texte avant ou après).
  `.trim();
  
    const userPrompt = `Contenu : """${content}"""`;
  
    const res = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.5
    });
  
    const parsed = JSON.parse(res.choices[0].message.content);
  
    // 🖼️ Extract image from article (og:image preferred)
    const articleHtml = await this.fetchHTML(url);
    const $ = cheerio.load(articleHtml);
  
    const imageUrl =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="og:image"]').attr('content') ||
      $('meta[property="twitter:image"]').attr('content') ||
      $('img')
        .map((_, el) => $(el).attr('src'))
        .get()
        .find(src => src?.startsWith('http')) ||
      null;
  
    const post: Partial<Post> = {
      title: parsed.title || '[No Title]',
      sourceUrl: url,
      sourceName,
      imageUrl, // ✅ most relevant image for article
      platforms: {
        twitter: Array.isArray(parsed.twitter) ? parsed.twitter.join('\n\n') : parsed.twitter || '',
        instagram: parsed.instagram || '',
        facebook: parsed.facebook || '',
        masmedia: parsed.masmedia || '',
      },
    };
  
    return post;
  }
  
}
