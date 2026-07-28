import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
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
  app.useStaticAssets(UPLOAD_DIR, { prefix: '/uploads/' });
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
