import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService, type ProductUpload } from './storage.service';

describe('StorageService validation', () => {
  const service = new StorageService(
    new ConfigService({
      MINIO_ENDPOINT: 'localhost',
      MINIO_PORT: '9000',
      MINIO_ACCESS_KEY: 'test-access',
      MINIO_SECRET_KEY: 'test-secret',
      MINIO_PUBLIC_BUCKET: 'test-public',
      MINIO_PUBLIC_URL: 'http://localhost:9000',
    }),
  );

  const upload = (mimetype: string, buffer: Buffer): ProductUpload => ({
    mimetype,
    buffer,
    originalname: 'spoofed-file',
    size: buffer.length,
  });

  it('rejects an image whose bytes do not match its MIME type', async () => {
    await expect(
      service.uploadProductImage(
        'product-1',
        upload('image/png', Buffer.from('not-a-png')),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a video whose bytes do not match its MIME type', async () => {
    await expect(
      service.uploadProductVideo(
        'product-1',
        upload('video/mp4', Buffer.from('not-an-mp4')),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
