import {
  BadRequestException,
  CallHandler,
  Controller,
  Delete,
  Get,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  commitFinanceImportBody,
  createFinanceImportBody,
  financeImportMappingBody,
  uuid,
  type CommitFinanceImportBody,
  type CreateFinanceImportBody,
  type FinanceImportMappingBody,
} from '@family/contracts';
import { memoryStorage } from 'multer';
import { catchError, throwError } from 'rxjs';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { ZodBody, ZodParam } from '../common/zod';
import { FinanceImportService } from './finance-import.service';
import { IMPORT_MAX_BYTES, IMPORT_TOO_LARGE } from './import/import-formats';

/** 只收 csv：支付宝的邮件附件是 zip，要先解压；微信新版导出 xlsx 的话另存为 csv。 */
function csvOnly(_request: unknown, file: Express.Multer.File, callback: (error: Error | null, accept: boolean) => void) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.zip')) return callback(new BadRequestException('这是 zip 压缩包：先解压，上传里面的 csv'), false);
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return callback(new BadRequestException('这是 Excel 文件：用 Excel / WPS 另存为 csv 再上传'), false);
  }
  return callback(null, true);
}

/** multer 超限抛的是英文「File too large」：换成中文提示。 */
@Injectable()
class ImportTooLargeMessage implements NestInterceptor {
  intercept(_context: unknown, next: CallHandler) {
    return next
      .handle()
      .pipe(
        catchError((error) =>
          throwError(() => (error instanceof PayloadTooLargeException ? new PayloadTooLargeException(IMPORT_TOO_LARGE) : error)),
        ),
      );
  }
}

/** K1 账单导入：导入算记账，成员可用（record_finance）。 */
@Controller('finance/imports')
@RequireCapabilities('view_finance', 'record_finance')
export class FinanceImportController {
  constructor(private readonly service: FinanceImportService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.service.list(user);
  }

  @Post()
  @UseInterceptors(
    ImportTooLargeMessage,
    FileInterceptor('file', { storage: memoryStorage(), fileFilter: csvOnly, limits: { fileSize: IMPORT_MAX_BYTES } }),
  )
  upload(
    @ZodBody(createFinanceImportBody) body: CreateFinanceImportBody,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.upload(file, body, user);
  }

  @Get(':id')
  preview(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser) {
    return this.service.preview(id, user);
  }

  @Post(':id/mapping')
  map(
    @ZodParam('id', uuid) id: string,
    @ZodBody(financeImportMappingBody) body: FinanceImportMappingBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.map(id, body.columnMapping, user);
  }

  @Post(':id/commit')
  commit(
    @ZodParam('id', uuid) id: string,
    @ZodBody(commitFinanceImportBody) body: CommitFinanceImportBody,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.commit(id, body, user);
  }

  @Delete(':id')
  discard(@ZodParam('id', uuid) id: string, @CurrentUser() user: JwtUser) {
    return this.service.discard(id, user);
  }
}
