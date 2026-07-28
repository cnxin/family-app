import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';
import { isCorsOriginAllowed } from './common/cors';
import { AllExceptionsFilter, TransformInterceptor } from './common/http';
import { UPLOAD_DIR } from './upload/upload.module';

async function bootstrap() {
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({
    origin: (origin, callback) => {
      callback(null, isCorsOriginAllowed(origin));
    },
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useStaticAssets(UPLOAD_DIR, { prefix: '/uploads/' });

  const port = Number(process.env.PORT || 3100);
  await app.listen(port, '0.0.0.0');
  console.log(`API ready: http://localhost:${port}`);
}
bootstrap();
