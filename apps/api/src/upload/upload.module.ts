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
import { extname, join } from 'path';

export const UPLOAD_DIR = join(process.cwd(), 'uploads');
export const PRIVATE_ASSET_UPLOAD_DIR = join(UPLOAD_DIR, '.private', 'assets');

@Controller()
export class UploadController {
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) =>
          cb(null, `${randomUUID()}${extname(file.originalname) || '.jpg'}`),
      }),
      fileFilter: (_req, file, cb) =>
        file.mimetype.startsWith('image/')
          ? cb(null, true)
          : cb(new BadRequestException('只支持图片文件'), false),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('没有收到文件');
    return { url: `/uploads/${file.filename}` };
  }
}

@Module({ controllers: [UploadController] })
export class UploadModule {}
