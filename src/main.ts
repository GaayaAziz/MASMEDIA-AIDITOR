import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  dotenv.config(); // Charge les variables .env
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api'); // Préfixe global pour les routes

  // Configuration CORS
  app.enableCors({
    origin: 'http://localhost:3000', 
    methods: 'GET,POST,PUT,DELETE', 
    allowedHeaders: 'Content-Type,Authorization', 
  });

  // Swagger Configuration
  const config = new DocumentBuilder()
    .setTitle('MASMEDIA-AIDITOR API')
    .setDescription('API documentation for MASMEDIA-AIDITOR')
    .setVersion('1.0')
    .addTag('llm-scraper') 
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(3006);
  console.log('🚀 Server running on http://localhost:3006');
  console.log('📄 Swagger documentation available at http://localhost:3006/api/docs');
}
bootstrap();



