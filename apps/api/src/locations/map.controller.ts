import { BadRequestException, Controller, Get, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import {
  MAP_BACKGROUND_MAX_BYTES,
  putHouseholdMapBody,
  putMapDecorationsBody,
  type PutHouseholdMapBody,
  type PutMapDecorationsBody,
} from '@family/contracts';
import { CurrentUser, JwtUser } from '../auth/jwt.guard';
import { multipartLimits } from '../common/multipart';
import { ZodBody } from '../common/zod';
import { MAP_BACKGROUND_TYPES, MapService } from './map.service';

/** /map：I2 家庭地图（item-location-plan §2.4）。形状改动走 PATCH /locations/:id/shape。 */
@Controller('map')
export class MapController {
  constructor(private readonly maps: MapService) {}

  @Get()
  get(@CurrentUser() user: JwtUser) {
    return this.maps.get(user.householdId);
  }

  @Put()
  put(@ZodBody(putHouseholdMapBody) body: PutHouseholdMapBody, @CurrentUser() user: JwtUser) {
    return this.maps.put(body, user);
  }

  @Put('decorations')
  putDecorations(@ZodBody(putMapDecorationsBody) body: PutMapDecorationsBody, @CurrentUser() user: JwtUser) {
    return this.maps.putDecorations(body, user);
  }

  @Post('background')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_request, file, callback) =>
        MAP_BACKGROUND_TYPES.has(file.mimetype)
          ? callback(null, true)
          : callback(new BadRequestException('底图只支持 PNG、JPEG、WebP 图片'), false),
      limits: multipartLimits({ fileSize: MAP_BACKGROUND_MAX_BYTES }),
    }),
  )
  uploadBackground(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: JwtUser) {
    return this.maps.setBackground(file, user);
  }

  @Get('export')
  export(@CurrentUser() user: JwtUser) {
    return this.maps.export(user);
  }

  @Get('background')
  async background(@CurrentUser() user: JwtUser, @Res() response: Response) {
    const { body, contentType } = await this.maps.background(user.householdId);
    response.setHeader('Content-Type', contentType);
    response.setHeader('Content-Length', String(body.length));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.status(200).end(body);
  }
}
