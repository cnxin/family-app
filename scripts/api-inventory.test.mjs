import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  collect,
  extractControllers,
  extractRoutes,
  loadContractKeys,
} from './api-inventory.mjs';

test('嵌套多行装饰器不会被当成处理函数', () => {
  const source = `
    @Controller('files')
    @RequireCapabilities('view_files')
    export class FilesController {
      @Post('upload')
      @RequireCapabilities('upload_files')
      @UseInterceptors(
        AuditInterceptor,
        FileInterceptor('file', {
          storage: memoryStorage({
            destination: join('uploads', nested('images')),
          }),
          fileFilter: (_request, file, callback) =>
            file.mimetype === 'image/png'
              ? callback(null, true)
              : callback(new BadRequestException('bad ) value'), false),
        }),
      )
      async uploadFile(@UploadedFile() file: unknown) {}
    }
  `;
  const [controller] = extractControllers(source);
  const [route] = extractRoutes(
    controller,
    join(process.cwd(), 'apps/api/src/fixtures/files.controller.ts'),
  );

  assert.equal(route.method, 'POST');
  assert.equal(route.path, '/files/upload');
  assert.equal(route.handler, 'uploadFile');
  assert.deepEqual(route.capabilities, ['view_files', 'upload_files']);
  assert.equal(route.isPublic, false);
});

test('真实上传接口正确识别处理函数并保留权限与契约', () => {
  const routes = collect();
  const byKey = new Map(routes.map((route) => [`${route.method} ${route.path}`, route]));
  const expectedHandlers = new Map([
    ['POST /assets/:id/documents/upload', 'uploadDocument'],
    ['POST /finance/imports', 'upload'],
    ['POST /finance/screenshot-recognize', 'recognize'],
    ['POST /map/background', 'uploadBackground'],
    [
      'POST /media/webhooks/playback/:provider/:integrationId/:secret',
      'receivePlaybackWebhook',
    ],
    ['POST /memories/:id/photos', 'uploadPhoto'],
    ['POST /upload', 'upload'],
  ]);

  assert.ok(routes.length > 0);
  assert.equal(byKey.size, routes.length, "路由方法与路径应唯一");
  for (const [key, handler] of expectedHandlers) {
    assert.equal(byKey.get(key)?.handler, handler, key);
  }
  assert.deepEqual(byKey.get('POST /assets/:id/documents/upload')?.capabilities, [
    'manage_assets',
  ]);
  assert.equal(
    byKey.get('POST /media/webhooks/playback/:provider/:integrationId/:secret')
      ?.isPublic,
    true,
  );

  const contractKeys = loadContractKeys();
  for (const key of byKey.keys()) {
    assert.ok(contractKeys.has(key), `缺少契约：${key}`);
  }
});
