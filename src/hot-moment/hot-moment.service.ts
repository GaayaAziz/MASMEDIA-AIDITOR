import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources';
import { HotMoment } from './schemas/hot-moment.schema';
import { Subject } from 'rxjs';
import * as fs from 'fs-extra';
import * as path from 'path';


type Capture = {
  offset: number;
  screenshotPath: string;
  gifPath: string;
  screenshotUrl: string; 
  gifUrl: string;      
};

@Injectable()
export class HotMomentService {
  private openai: OpenAI;
  public postStream$ = new Subject<{
    threadId: string;
    title: string;
    posts: any;
    captures: any[];
    id?: any;
    content?: string;
    createdAt?: Date;
    history?: boolean; // flag pour éléments historiques envoyés au démarrage
  type?: string; // 'hot-moment' | 'hot-moment-progress'
  }>();

  private threadsHistory: Record<
    string,
    { role: 'system' | 'user' | 'assistant'; content: string }[]
  > = {};

  private lastMomentTitleByThread: Record<string, string | null> = {};
  private hotMomentContentByThread: Record<string, string> = {};

  // ✅ Temporary capture store
  public pendingCaptures: Record<string, Capture[]> = {};

  constructor(
    @InjectModel(HotMoment.name) private hotMomentModel: Model<HotMoment>,
  ) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async createThread(): Promise<string> {
    const threadId = `thread_${Date.now()}`;
    this.threadsHistory[threadId] = [
      {
        role: 'system',
        content: `
Tu es un expert en analyse de live tech. 
Ton objectif est de détecter les moments clés en temps réel.

Règles importantes :
1. Un "moment clé" commence dès qu'un NOUVEAU sujet majeur est abordé.
2. Si on continue à parler du MÊME sujet, tu DOIS réutiliser EXACTEMENT le même titre (copie conforme).
3. Si le sujet CHANGE complètement, alors "continuation" = false et on génère un NOUVEAU titre.
4. Si c'est une introduction générale, un remerciement ou un Q&A banal :
   "is_hot_moment" = false, "moment_title" = null, "continuation" = false.
5. Un moment clé se poursuit tant que l’on parle du même produit ou sujet.
6. Ne JAMAIS mettre "is_hot_moment" = false si on est toujours sur le même sujet.

Réponds STRICTEMENT en JSON :
{
  "is_hot_moment": true/false,
  "moment_title": "Titre court si moment clé, sinon null",
  "continuation": true/false
}`
      }
    ];
    this.lastMomentTitleByThread[threadId] = null;
    this.hotMomentContentByThread[threadId] = '';
    return threadId;
  }

  async analyzeParagraph(threadId: string, paragraph: string) {
    if (!this.threadsHistory[threadId]) {
      throw new Error(`Thread ${threadId} inexistant`);
    }

    const context = this.hotMomentContentByThread[threadId]?.trim() || '';
    const fullPrompt = `
CONTEXTE ACCUMULÉ :
"""${context}"""

NOUVEAU PARAGRAPHE :
"""${paragraph.trim()}"""

Tu es un expert en analyse de live tech.
Ton objectif est de détecter les moments clés en temps réel.

Voici les règles :

1. Un "moment clé" commence dès qu'un **nouveau sujet majeur** est abordé (nouveau produit, nouvelle annonce, changement clair de sujet).
2. Si le sujet est **le même qu'avant**, tu dois **garder exactement le même titre** (copie exacte).
3. Si on change complètement de sujet, alors "continuation" = false et un **nouveau titre** doit être généré.
4. Si c'est une introduction, un remerciement ou un Q&A sans intérêt, réponds :
   {
     "is_hot_moment": false,
     "moment_title": null,
     "continuation": false
   }
5. Si on reste sur le même produit ou le même sujet, tu continues le moment en gardant le même titre.
6. Ne JAMAIS mettre "is_hot_moment": false si on est toujours dans le même sujet.

Réponds STRICTEMENT en JSON comme ceci :
{
  "is_hot_moment": true/false,
  "moment_title": "Titre court si moment clé, sinon null",
  "continuation": true/false
}
`.trim();

    this.threadsHistory[threadId].push({
      role: 'user',
      content: fullPrompt,
    });

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: this.threadsHistory[threadId],
      temperature: 0.3,
    });

    const response = completion.choices[0].message.content || '{}';
    let result;
    try {
      result = JSON.parse(response);
    } catch {
      console.error('Erreur parsing JSON :', response);
      result = { is_hot_moment: false, moment_title: null, continuation: false };
    }

    const lastTitle = this.lastMomentTitleByThread[threadId];
    if (lastTitle && result.moment_title) {
      const checkContinuation = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Tu dois décider si deux titres parlent du même sujet tech ou pas.
                Réponds uniquement par "true" ou "false". Aucune autre information.`
          },
          {
            role: 'user',
            content: `Titre A : "${lastTitle}"\nTitre B : "${result.moment_title}"\nMême sujet ?`
          }
        ],
        temperature: 0.0,
      });

      const gptResponse = checkContinuation.choices[0].message.content?.trim();
      const sameTopic = gptResponse === 'true';

      if (sameTopic) {
        result.is_hot_moment = true;
        result.continuation = true;
        result.moment_title = lastTitle;
      } else {
        if (lastTitle && this.hotMomentContentByThread[threadId]) {
          const posts = await this.generateSocialPosts(
            lastTitle,
            this.hotMomentContentByThread[threadId],
          );

          const captures = this.pendingCaptures[threadId] || [];
          // Désormais on n'émet PLUS avant la sauvegarde: emission centralisée dans saveHotMoment
          await this.saveHotMoment(
            threadId,
            lastTitle,
            this.hotMomentContentByThread[threadId],
            posts,
            captures,
          );

          delete this.pendingCaptures[threadId]; // ✅ reset
        }

        this.hotMomentContentByThread[threadId] = '';
        this.lastMomentTitleByThread[threadId] = result.moment_title;
        result.continuation = false;
      }
    } else {
      if (result.is_hot_moment && result.moment_title) {
        this.lastMomentTitleByThread[threadId] = result.moment_title;
      }
      result.continuation = false;
    }

    if (result.is_hot_moment && result.moment_title) {
      this.hotMomentContentByThread[threadId] += paragraph + '\n';
    }

    this.threadsHistory[threadId].push({
      role: 'assistant',
      content: JSON.stringify(result),
    });

    if (
      !result.is_hot_moment &&
      this.lastMomentTitleByThread[threadId] &&
      this.hotMomentContentByThread[threadId]
    ) {
      console.log('🛑 Fin détectée : on sauvegarde le hot moment précédent.');

      const title = this.lastMomentTitleByThread[threadId];
      const content = this.hotMomentContentByThread[threadId];
      const posts = await this.generateSocialPosts(title, content);
      const captures = this.pendingCaptures[threadId] || [];

      await this.saveHotMoment(threadId, title, content, posts, captures);

      delete this.pendingCaptures[threadId];
      this.hotMomentContentByThread[threadId] = '';
      this.lastMomentTitleByThread[threadId] = '';
    }

    return result;
  }

  async generateSocialPosts(title: string, content: string) {
    const prompt = `
Tu es un expert en stratégie de contenu pour réseaux sociaux spécialisés dans la tech.

À partir du **titre** et du **contenu** d’un moment clé d’un live événementiel, tu vas générer un **JSON bien structuré** avec des posts parfaitement adaptés à chaque plateforme.

🎯 Objectif : permettre une diffusion instantanée sur les réseaux, avec un ton, une structure et une forme native à chaque canal.

---

🟦 "twitter" (X)
- Format THREAD : chaque élément est une ligne du tableau
- Style court, percutant, informatif
- Utilise des hashtags pertinents
- Ajoute des emojis avec parcimonie
- Premier post = intro (titre du moment)
- Dernier post = appel à action ou question

---

📸 "instagram"
- Format vertical, bien aéré
- Utilise des emojis pour rythmer le texte
- Texte accessible, humain, enthousiasme
- Saute des lignes entre les idées
- Ajoute un ou deux hashtags finaux

---

🔵 "facebook"
- Ton engageant et professionnel
- Résume l’événement avec du contexte
- 1 paragraphe clair (3-6 phrases)
- Incite à la discussion ou au partage

---

📰 "masmedia"
- Format mini-article HTML pour publication web
- Structure attendue :
  - <h2> pour le titre
  - <p> pour chaque paragraphe
  - Commence par un petit contexte
  - Éviter le ton promotionnel : rester factuel, journalistique
  - Peut mentionner qu’un **screenshot du live** précède ce texte
  - Ne jamais inclure le screenshot, seulement le texte HTML

---

✳️ Réponds uniquement avec un JSON propre comme ceci :
{
  "twitter": ["...thread1", "...thread2"],
  "instagram": "...",
  "facebook": "...",
  "masmedia": "..."
}

Ne mets **aucune balise \`\`\`json**, ni phrase introductive, ni commentaire. Juste le JSON pur.
`;

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Titre : "${title}"\nContenu : """${content}"""`,
      },
    ];

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.5,
    });

    const response = completion.choices[0].message.content || '{}';

    try {
      return JSON.parse(response);
    } catch (err) {
      
      return {};
    }
  }

private async saveHotMoment(
  threadId: string,
  title: string,
  content: string,
  posts?: {
    twitter?: string[];
    instagram?: string;
    facebook?: string;
    masmedia?: string;
  },
  captures?: Capture[],
) {
  const hotMoment = new this.hotMomentModel({
    thread_id: threadId,
    moment_title: title,
    content: content.trim(),
    posts: posts || undefined,
    captures: captures || undefined,
  });

  await hotMoment.save();
  console.log(`✅ Hot moment sauvegardé: ${title}`);

  // 🚀 Émission temps réel après sauvegarde
  try {
    this.postStream$.next({
      threadId,
      title,
      posts: posts || {},
      captures: captures || [],
      id: hotMoment._id,
      content: content.trim(),
      createdAt: (hotMoment as any).createdAt,
      type: 'hot-moment',
    });
  } catch (e) {
    console.error('Erreur émission SSE hot-moment:', e);
  }

}

  async finalizeThread(threadId: string) {
    const lastTitle = this.lastMomentTitleByThread[threadId];
    const content = this.hotMomentContentByThread[threadId];

    if (lastTitle && content) {
      const posts = await this.generateSocialPosts(lastTitle, content);
      const captures = this.pendingCaptures[threadId] || [];

      await this.saveHotMoment(threadId, lastTitle, content, posts, captures);
      delete this.pendingCaptures[threadId];
      this.hotMomentContentByThread[threadId] = '';
    }
  }

  async getHotMomentsByThreadId(threadId: string) {
    return this.hotMomentModel.find({ thread_id: threadId }).exec();
  }

  async getPostsByHotMomentId(hotMomentId: string) {
  const moment = await this.hotMomentModel.findById(hotMomentId).exec();
  return moment?.posts || null;
  }

  async updatePostsByHotMomentId(hotMomentId: string, newPosts: any) {
    return this.hotMomentModel.findByIdAndUpdate(
      hotMomentId,
      { posts: newPosts },
      { new: true }
    ).exec();
  }

  async getHotMomentById(id: string) {
    return this.hotMomentModel.findById(id).lean();
  }

  async markAsPublishedHotMoment(
    hotMomentId: string,
    platform: 'facebook' | 'instagram',
    publishedId: string
  ) {
    const update: any = {};
    update[`publishedTo.${platform}`] = {
      published: true,
      publishedAt: new Date(),
      publishedId,
    };
    return this.hotMomentModel
      .findByIdAndUpdate(hotMomentId, { $set: update }, { new: true })
      .lean();
  }

  async clearPublishedHotMoment(
    hotMomentId: string,
    platform: 'facebook' | 'instagram'
  ): Promise<void> {
    const p = `publishedTo.${platform}`;
    await this.hotMomentModel.updateOne(
      { _id: hotMomentId },
      {
        $set: {
          [`${p}.published`]: false,
          [`${p}.publishedAt`]: null,
          [`${p}.publishedId`]: null,
        },
      }
    );
  }

  async getAllHotMoments() {
    return this.hotMomentModel.find().exec();
  }

  async getRecentHotMoments(limit = 50) {
    const docs = await this.hotMomentModel
      .find({}, null)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return docs.reverse(); // renvoyer dans l'ordre chronologique
  }

  async getRecentHotMomentsByThread(threadId: string, limit = 50) {
    const docs = await this.hotMomentModel
      .find({ thread_id: threadId }, null)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return docs.reverse();
  }

  /** Récupère uniquement les posts de tous les hot moments d'un thread */
  async getPostsByThread(threadId: string) {
    const docs = await this.hotMomentModel
      .find({ thread_id: threadId }, { posts: 1, moment_title: 1, createdAt: 1 })
      .sort({ createdAt: 1 })
      .lean();
    return docs.map(d => ({
      id: d._id,
      title: (d as any).moment_title,
      createdAt: (d as any).createdAt,
      posts: (d as any).posts || null,
    }));
  }

  /**
   * Liste les captures (jpg/gif) réellement présentes sur le disque pour un thread.
   * Utile pour debug d'URLs cassées.
   */
  async listCaptures(threadId: string) {
    const dir = path.join(process.cwd(), 'captures', threadId);
    const exists = await fs.pathExists(dir);
    if (!exists) return [];

    const files = await fs.readdir(dir);
    const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3001';
    const stats = await Promise.all(
      files
        .filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f))
        .map(async (f) => {
          const abs = path.join(dir, f);
          const s = await fs.stat(abs);
          return {
            file: f,
            size: s.size,
            modifiedAt: s.mtime,
            type: f.toLowerCase().endsWith('.gif') ? 'gif' : 'image',
            url: `${base}/media/${encodeURIComponent(threadId)}/${encodeURIComponent(f)}`,
          };
        })
    );
    return stats.sort((a, b) => a.file.localeCompare(b.file));
  }

}
