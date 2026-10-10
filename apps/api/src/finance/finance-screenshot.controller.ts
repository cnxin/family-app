import {
  BadRequestException,
  CallHandler,
  Controller,
  Get,
  Injectable,
  Module,
  NestInterceptor,
  PayloadTooLargeException,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { FINANCE_SCREENSHOT_MAX_BYTES, uuid } from '@family/contracts';
import { memoryStorage } from 'multer';
import { catchError, throwError } from 'rxjs';
import { AgentModule } from '../agent/agent.module';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { multipartLimits } from '../common/multipart';
import { ZodParam } from '../common/zod';
import { FinanceScreenshotCleanup } from './finance-screenshot.cleanup';
import { FinanceScreenshotService } from './finance-screenshot.service';

/** 截图超过 4 MB：multer 报 413 英文，按指令回 400 中文。 */
@Injectable()
class ScreenshotTooLarge implements NestInterceptor {
  intercept(_context: unknown, next: CallHandler) {
    return next
      .handle()
      .pipe(
        catchError((error) =>
          throwError(() => (error instanceof PayloadTooLargeException ? new BadRequestException('截图不能超过 4 MB') : error)),
        ),
      );
  }
}

/** K2 截图记账：识别算记账（record_finance），另外要第 2 档对当前成员开放（服务里判）。 */
@Controller('finance')
@RequireCapabilities('view_finance')
export class FinanceScreenshotController {
  constructor(private readonly screenshots: FinanceScreenshotService) {}

  @Post('screenshot-recognize')
  @RequireCapabilities('record_finance')
  @UseInterceptors(
    ScreenshotTooLarge,
    FileInterceptor('file', { storage: memoryStorage(), limits: multipartLimits({ fileSize: FINANCE_SCREENSHOT_MAX_BYTES }) }),
  )
  recognize(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: JwtUser) {
    return this.screenshots.recognize(file, user);
  }

  @Get('transactions/:id/attachment')
  async attachment(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser, @Res() response: Response) {
    const { body, contentType } = await this.screenshots.attachment(id, user);
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Length', String(body.length));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.status(200).end(body);
  }
}

/** K2 截图记账：控制器、服务与孤儿截图清理；识别用内核的云端看图（AgentModule 导出的 AgentVisionService）。FinanceModule 引入。 */
@Module({
  imports: [AgentModule],
  controllers: [FinanceScreenshotController],
  providers: [FinanceScreenshotService, FinanceScreenshotCleanup],
})
export class FinanceScreenshotModule {}
