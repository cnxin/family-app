import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { extname } from 'node:path';
import { memoryStorage } from 'multer';
import { CurrentUser, JwtUser, Public } from '../auth/jwt.guard';
import { multipartLimits } from '../common/multipart';
import {
  MemoryListQueryDto,
  CreateMemoryDto,
  UpdateMemoryDto,
  MemoryVersionOperationDto,
  UploadMemoryPhotoDto,
} from './memories.dto';
import { MemoriesService } from './memories.service';
import { MemoryPhotosService } from './memory-photos.service';
import { MemoryWritesService } from './memory-writes.service';

const MEMORY_PHOTO_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Controller()
export class MemoriesController {
  constructor(
    private readonly service: MemoriesService,
    private readonly photoService: MemoryPhotosService,
    private readonly writes: MemoryWritesService,
  ) {}

  @Get('memories')
  list(@Query() query: MemoryListQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user);
  }

  @Get('memories/:id')
  detail(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.detail(id, user);
  }

  @Post('memories')
  create(@Body() dto: CreateMemoryDto, @CurrentUser() user: JwtUser) {
    return this.writes.create(dto, user);
  }

  @Patch('memories/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMemoryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.writes.update(id, dto, user);
  }

  @Post('memories/:id/archive')
  archive(
    @Param('id') id: string,
    @Body() dto: MemoryVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.writes.archive(id, dto, user);
  }

  @Post('memories/:id/restore')
  restore(
    @Param('id') id: string,
    @Body() dto: MemoryVersionOperationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.writes.restore(id, dto, user);
  }

  @Post('memories/:id/photos')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_request, file, callback) =>
        MEMORY_PHOTO_MIME_TYPES.has(file.mimetype)
          ? callback(null, true)
          : callback(
              new BadRequestException('回忆照片只支持 GIF、JPEG、PNG 或 WebP'),
              false,
            ),
      limits: multipartLimits({ fileSize: 10 * 1024 * 1024 }),
    }),
  )
  uploadPhoto(
    @Param('id') id: string,
    @Body() dto: UploadMemoryPhotoDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.photoService.uploadPhoto(id, dto, file, user);
  }

  @Public()
  @Get('memories/:memoryId/photos/:photoId/content')
  async photoContent(
    @Param('memoryId') memoryId: string,
    @Param('photoId') photoId: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res() response: Response,
  ) {
    const content = await this.photoService.photoContent(
      memoryId,
      photoId,
      expires,
      signature,
    );
    const extension = extname(content.fileName).toLowerCase();
    response.setHeader('Content-Type', content.contentType);
    response.setHeader('Content-Length', String(content.body.length));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="family-memory${extension}"`,
    );
    response.status(200).end(content.body);
  }
}
