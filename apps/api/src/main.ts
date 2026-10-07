import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app/app.module';
import { configureApp } from './app/configure-app';
import { ENV, type Env } from './core';

async function bootstrap() {
  // Local development reads .env; containers get real environment variables.
  if (existsSync('.env')) process.loadEnvFile('.env');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  configureApp(app);
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
