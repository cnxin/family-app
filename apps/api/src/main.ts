import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import { mkdirSync } from 'fs';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import {
  trustProxyHops,
  validateRuntimeConfiguration,
} from './common/config';
import { isCorsOriginAllowed } from './common/cors';
import { AllExceptionsFilter, TransformInterceptor } from './common/http';
import {
  StructuredLogger,
  requestContextMiddleware,
  summarizeException,
} from './common/observability';
import { AssetDocument } from './entities';
import { UPLOAD_DIR } from './upload/upload.module';

const logger = new StructuredLogger();

async function bootstrap() {
  validateRuntimeConfiguration();
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
  });
  const proxyHops = trustProxyHops();
  if (proxyHops > 0) app.set('trust proxy', proxyHops);
  app.use(requestContextMiddleware(logger));
  app.enableCors({
    origin: (origin, callback) => {
      callback(null, isCorsOriginAllowed(origin));
    },
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  const assetDocuments = app.get(DataSource).getRepository(AssetDocument);
  app.use(
    '/uploads',
    (request: Request, response: Response, next: NextFunction) => {
      const relativePath = request.path.replace(/^\/+/, '');
      if (!relativePath || relativePath.split('/').includes('.private')) {
        response.sendStatus(404);
        return;
      }
      void assetDocuments
        .existsBy({ url: `/uploads/${relativePath}` })
        .then((isProtected) => {
          if (isProtected) response.sendStatus(404);
          else next();
        })
        .catch(() => {
          response.status(503).json({
            error: {
              code: 'UPLOAD_ACCESS_UNAVAILABLE',
              message: '文件访问暂时不可用',
            },
          });
        });
    },
  );
  app.useStaticAssets(UPLOAD_DIR, {
    prefix: '/uploads/',
    dotfiles: 'deny',
  });
  app.enableShutdownHooks();

  const port = Number(process.env.PORT || 3100);
  await app.listen(port, '0.0.0.0');
  logger.write('info', 'api_started', { port, trustProxyHops: proxyHops });
}
bootstrap().catch((error: unknown) => {
  logger.write('error', 'startup_failed', {
    summary: summarizeException(error),
  });
  process.exitCode = 1;
});
