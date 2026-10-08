import { describe, expect, it } from 'vitest';
import { ApiError, uploadErrorMessage } from './api';

describe('uploadErrorMessage', () => {
  it('类型不支持（400）用服务端的原因，太大（413）说上限', () => {
    expect(uploadErrorMessage(new ApiError('Bad Request', '只支持 JPG、PNG、WebP、GIF、HEIC、BMP 图片', 400), '再试一次')).toBe(
      '只支持 JPG、PNG、WebP、GIF、HEIC、BMP 图片',
    );
    expect(uploadErrorMessage(new ApiError('Payload Too Large', 'File too large', 413), '再试一次')).toBe('照片太大了，不能超过 10 MB');
  });

  it('网络错误、服务端 5xx、未登录：用调用方给的兜底', () => {
    expect(uploadErrorMessage(new TypeError('Failed to fetch'), '再试一次')).toBe('再试一次');
    expect(uploadErrorMessage(new ApiError('INTERNAL_ERROR', 'boom', 500), '再试一次')).toBe('再试一次');
    expect(uploadErrorMessage(new ApiError('Unauthorized', '未登录', 401), '再试一次')).toBe('再试一次');
  });
});
