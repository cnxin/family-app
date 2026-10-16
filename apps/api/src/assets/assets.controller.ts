import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { extname } from 'node:path';
import { memoryStorage } from 'multer';
import { RequireCapabilities } from '../auth/capabilities';
import { CurrentUser, JwtUser, Public } from '../auth/jwt.guard';
import { multipartLimits } from '../common/multipart';
import {
  AssetListQueryDto,
  CreateAssetDto,
  UpdateAssetDto,
  RenewSubscriptionDto,
  CreateAssetDocumentDto,
  UploadAssetDocumentDto,
  CreateMaintenancePlanDto,
  UpdateMaintenancePlanDto,
  CompleteMaintenanceDto,
  CreateMaintenanceConsumableDto,
  UpdateMaintenanceConsumableDto,
  AddMaintenanceShoppingDto,
  SetAssetLocationDto,
} from './assets.dto';
import { AssetsService } from './assets.service';
import { AssetDocumentsService } from './asset-documents.service';
import { AssetMaintenanceService } from './asset-maintenance.service';
import { AssetConsumablesService } from './asset-consumables.service';

const ASSET_DOCUMENT_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

@Controller()
export class AssetsController {
  constructor(
    private readonly service: AssetsService,
    private readonly documentsService: AssetDocumentsService,
    private readonly maintenance: AssetMaintenanceService,
    private readonly consumablesService: AssetConsumablesService,
  ) {}

  @Get('assets')
  list(@Query() query: AssetListQueryDto, @CurrentUser() user: JwtUser) {
    return this.service.list(query, user.householdId);
  }

  @Get('assets/:id')
  get(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.get(id, user.householdId);
  }

  @Post('assets')
  @RequireCapabilities('manage_assets')
  create(@Body() dto: CreateAssetDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Patch('assets/:id')
  @RequireCapabilities('manage_assets')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch('assets/:id/location')
  @RequireCapabilities('manage_assets')
  setLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAssetLocationDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.setLocation(id, dto.locationId ?? null, user);
  }

  @Post('assets/:id/renew')
  @RequireCapabilities('manage_assets')
  renewSubscription(
    @Param('id') id: string,
    @Body() dto: RenewSubscriptionDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.renewSubscription(id, dto, user);
  }

  @Post('assets/:id/documents')
  @RequireCapabilities('manage_assets')
  createDocument(
    @Param('id') id: string,
    @Body() dto: CreateAssetDocumentDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentsService.createDocument(id, dto, user);
  }

  @Post('assets/:id/documents/upload')
  @RequireCapabilities('manage_assets')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_request, file, callback) =>
        ASSET_DOCUMENT_MIME_TYPES.has(file.mimetype)
          ? callback(null, true)
          : callback(
              new BadRequestException('资产资料只支持图片或 PDF 文件'),
              false,
            ),
      limits: multipartLimits({ fileSize: 10 * 1024 * 1024 }),
    }),
  )
  uploadDocument(
    @Param('id') id: string,
    @Body() dto: UploadAssetDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentsService.createUploadedDocument(id, dto, file, user);
  }

  @Get('asset-documents/:id/access')
  documentAccess(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.documentsService.documentAccess(id, user);
  }

  @Public()
  @Get('asset-documents/:id/content')
  async documentContent(
    @Param('id') id: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res() response: Response,
  ) {
    const content = await this.documentsService.documentContent(
      id,
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
      `inline; filename="asset-document${extension}"; filename*=UTF-8''${encodeURIComponent(content.fileName)}`,
    );
    response.status(200).end(content.body);
  }

  @Delete('asset-documents/:id')
  @RequireCapabilities('manage_assets')
  removeDocument(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.documentsService.removeDocument(id, user);
  }

  @Post('assets/:id/maintenance-plans')
  @RequireCapabilities('manage_assets')
  createPlan(
    @Param('id') id: string,
    @Body() dto: CreateMaintenancePlanDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.maintenance.createPlan(id, dto, user);
  }

  @Patch('maintenance-plans/:id')
  @RequireCapabilities('manage_assets')
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdateMaintenancePlanDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.maintenance.updatePlan(id, dto, user);
  }

  @Post('maintenance-plans/:id/consumables')
  @RequireCapabilities('manage_assets', 'manage_inventory')
  createConsumable(
    @Param('id') id: string,
    @Body() dto: CreateMaintenanceConsumableDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.consumablesService.createConsumable(id, dto, user);
  }

  @Patch('maintenance-consumables/:id')
  @RequireCapabilities('manage_assets', 'manage_inventory')
  updateConsumable(
    @Param('id') id: string,
    @Body() dto: UpdateMaintenanceConsumableDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.consumablesService.updateConsumable(id, dto, user);
  }

  @Delete('maintenance-consumables/:id')
  @RequireCapabilities('manage_assets', 'manage_inventory')
  removeConsumable(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.consumablesService.removeConsumable(id, user);
  }

  @Get('maintenance-plans/:id/consumables-preview')
  consumablesPreview(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.consumablesService.consumablesPreview(id, user.householdId);
  }

  @Post('maintenance-plans/:id/shopping-items')
  @RequireCapabilities('manage_assets', 'manage_shopping')
  addConsumablesToShopping(
    @Param('id') id: string,
    @Body() dto: AddMaintenanceShoppingDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.consumablesService.addConsumablesToShopping(id, dto, user);
  }

  @Post('maintenance-plans/:id/complete')
  @RequireCapabilities('manage_assets')
  completePlan(
    @Param('id') id: string,
    @Body() dto: CompleteMaintenanceDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.maintenance.completePlan(id, dto, user);
  }
}
