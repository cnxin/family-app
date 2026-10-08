import {
  BadRequestException,
  Controller,
  Module,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { join, resolve } from 'path';
import { multipartLimits } from '../common/multipart';

export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? resolve(process.env.UPLOAD_DIR)
  : join(process.cwd(), 'uploads');
export const PRIVATE_ASSET_UPLOAD_DIR = join(UPLOAD_DIR, '.private', 'assets');

/**
 * 落盘扩展名只按声明的类型从白名单里取，不用客户端给的文件名：否则 x.html 声明成 image/png 会存成 .html，
 * 经同源的 /uploads 以 text/html 返回（存储型 XSS）。svg 能带脚本，不收。image/jpg、image/pjpeg 是少数客户端
 * 报的非标准写法，bmp 是桌面上偶尔会选到的格式：扩展名都固定，不会重新带回 XSS。
 */
const IMAGE_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/pjpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif'],
  ['image/bmp', '.bmp'],
]);
export const UNSUPPORTED_IMAGE = '只支持 JPG、PNG、WebP、GIF、HEIC、BMP 图片';

@Controller()
export class UploadController {
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) =>
          cb(null, `${randomUUID()}${IMAGE_EXTENSIONS.get(file.mimetype)}`),
      }),
      fileFilter: (_req, file, cb) =>
        IMAGE_EXTENSIONS.has(file.mimetype)
          ? cb(null, true)
          : cb(new BadRequestException(UNSUPPORTED_IMAGE), false),
      limits: multipartLimits({ fileSize: 10 * 1024 * 1024 }),
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('没有收到文件');
    return { url: `/uploads/${file.filename}` };
  }
}

@Module({ controllers: [UploadController] })
export class UploadModule {}
