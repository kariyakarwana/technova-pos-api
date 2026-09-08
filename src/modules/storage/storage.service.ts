import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

export type ProductUpload = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

export type StoredObject = {
  bucket: string;
  objectKey: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  originalName: string;
};

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Client;
  private readonly publicBucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    const useSSL = this.config.get<string>('MINIO_USE_SSL') === 'true';
    const endpointValue =
      this.config.get<string>('MINIO_ENDPOINT') ?? 'localhost';
    const parsed = new URL(
      endpointValue.includes('://')
        ? endpointValue
        : `${useSSL ? 'https' : 'http'}://${endpointValue}`,
    );
    const port = Number(
      this.config.get<string>('MINIO_PORT') ||
        parsed.port ||
        (useSSL ? 443 : 9000),
    );
    this.publicBucket =
      this.config.get<string>('MINIO_PUBLIC_BUCKET') ?? 'technova-public';
    this.publicUrl = (
      this.config.get<string>('MINIO_PUBLIC_URL') ??
      `${useSSL ? 'https' : 'http'}://${parsed.hostname}:${port}`
    ).replace(/\/$/, '');
    this.client = new Client({
      endPoint: parsed.hostname,
      port,
      useSSL,
      accessKey:
        this.config.get<string>('MINIO_ACCESS_KEY') ??
        this.config.getOrThrow<string>('MINIO_ROOT_USER'),
      secretKey:
        this.config.get<string>('MINIO_SECRET_KEY') ??
        this.config.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
    });
  }

  async onModuleInit() {
    try {
      await this.ensurePublicBucket();
    } catch (error) {
      this.logger.warn(
        `MinIO is not ready yet; uploads will retry on demand. ${error instanceof Error ? error.message : ''}`,
      );
    }
  }

  async uploadProductImage(productId: string, file: ProductUpload) {
    const allowed = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException('Use a JPEG, PNG, WebP, or GIF image.');
    }
    if (!this.hasValidImageSignature(file)) {
      throw new BadRequestException(
        'The uploaded file content is not a valid supported image.',
      );
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new BadRequestException(
        'Each product image must be 8 MB or smaller.',
      );
    }
    return this.upload(productId, 'images', file);
  }

  async uploadProductVideo(productId: string, file: ProductUpload) {
    const allowed = new Set(['video/mp4', 'video/webm']);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException(
        'Use an MP4 or WebM video so it can play in the browser.',
      );
    }
    if (!this.hasValidVideoSignature(file)) {
      throw new BadRequestException(
        'The uploaded file content is not a valid MP4 or WebM video.',
      );
    }
    if (file.size > 50 * 1024 * 1024) {
      throw new BadRequestException(
        'The product video must be 50 MB or smaller.',
      );
    }
    return this.upload(productId, 'videos', file);
  }

  async uploadOrganizationLogo(organizationId: string, file: ProductUpload) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException('Use a JPEG, PNG, or WebP company logo.');
    }
    if (!this.hasValidImageSignature(file)) {
      throw new BadRequestException(
        'The uploaded file content is not a valid supported image.',
      );
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException(
        'The company logo must be 5 MB or smaller.',
      );
    }
    return this.upload(organizationId, 'branding', file, 'organizations');
  }

  async remove(bucket: string | null, objectKey: string | null) {
    if (!bucket || !objectKey) return;
    try {
      await this.client.removeObject(bucket, objectKey);
    } catch (error) {
      this.logger.warn(
        `Unable to remove orphaned object ${objectKey}. ${error instanceof Error ? error.message : ''}`,
      );
    }
  }

  private async upload(
    ownerId: string,
    folder: string,
    file: ProductUpload,
    root = 'products',
  ) {
    await this.ensurePublicBucket();
    const extension = extname(file.originalname)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '');
    const objectKey = `${root}/${ownerId}/${folder}/${randomUUID()}${extension}`;
    try {
      await this.client.putObject(
        this.publicBucket,
        objectKey,
        file.buffer,
        file.size,
        { 'Content-Type': file.mimetype },
      );
    } catch (error) {
      throw new ServiceUnavailableException(
        `Object storage is unavailable. ${error instanceof Error ? error.message : ''}`,
      );
    }
    return {
      bucket: this.publicBucket,
      objectKey,
      url: `${this.publicUrl}/${this.publicBucket}/${objectKey}`,
      contentType: file.mimetype,
      sizeBytes: file.size,
      originalName: file.originalname,
    } satisfies StoredObject;
  }

  private async ensurePublicBucket() {
    if (!(await this.client.bucketExists(this.publicBucket))) {
      await this.client.makeBucket(this.publicBucket);
    }
    await this.client.setBucketPolicy(
      this.publicBucket,
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.publicBucket}/*`],
          },
        ],
      }),
    );
  }

  private hasValidImageSignature(file: ProductUpload) {
    const bytes = file.buffer;
    if (file.mimetype === 'image/jpeg')
      return (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      );
    if (file.mimetype === 'image/png')
      return bytes
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (file.mimetype === 'image/webp')
      return (
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    if (file.mimetype === 'image/gif')
      return ['GIF87a', 'GIF89a'].includes(
        bytes.subarray(0, 6).toString('ascii'),
      );
    return false;
  }

  private hasValidVideoSignature(file: ProductUpload) {
    const bytes = file.buffer;
    if (file.mimetype === 'video/mp4')
      return (
        bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp'
      );
    if (file.mimetype === 'video/webm')
      return (
        bytes.length >= 4 &&
        bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      );
    return false;
  }
}
