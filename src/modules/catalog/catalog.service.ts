import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ProductImage, type ProductVideo } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { paginate } from '../../common/dto/pagination.dto';
import type { SecurityRequestContext } from '../../common/security/request';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { type ProductUpload, StorageService } from '../storage/storage.service';
import {
  CreateBrandDto,
  CreateCategoryDto,
  CreateProductDto,
  ProductQueryDto,
  UpdateBrandDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './dto/catalog.dto';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}
  private async organizationId(userId: string) {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId },
    });
    if (!membership) throw new NotFoundException('Organization not found.');
    return membership.organizationId;
  }

  async categories(userId: string) {
    const organizationId = await this.organizationId(userId);
    return this.prisma.category.findMany({
      where: { organizationId },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { products: true, children: true } },
      },
      orderBy: { name: 'asc' },
    });
  }
  async createCategory(
    actor: AuthenticatedUser,
    dto: CreateCategoryDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    if (dto.parentId) await this.assertCategory(organizationId, dto.parentId);
    return this.unique(async () => {
      const value = await this.prisma.category.create({
        data: { ...dto, name: dto.name.trim(), organizationId },
      });
      await this.audit.record({
        userId: actor.id,
        action: 'CATEGORY_CREATED',
        context,
        metadata: { categoryId: value.id },
      });
      return value;
    }, 'Category name already exists.');
  }
  async updateCategory(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateCategoryDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    await this.assertCategory(organizationId, id);
    if (dto.parentId === id)
      throw new ConflictException('A category cannot be its own parent.');
    if (dto.parentId) await this.assertCategory(organizationId, dto.parentId);
    const value = await this.prisma.category.update({
      where: { id },
      data: dto,
    });
    await this.audit.record({
      userId: actor.id,
      action: 'CATEGORY_UPDATED',
      context,
      metadata: { categoryId: id },
    });
    return value;
  }

  async brands(userId: string) {
    const organizationId = await this.organizationId(userId);
    return this.prisma.brand.findMany({
      where: { organizationId },
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
  }
  async createBrand(
    actor: AuthenticatedUser,
    dto: CreateBrandDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    return this.unique(async () => {
      const value = await this.prisma.brand.create({
        data: { ...dto, name: dto.name.trim(), organizationId },
      });
      await this.audit.record({
        userId: actor.id,
        action: 'BRAND_CREATED',
        context,
        metadata: { brandId: value.id },
      });
      return value;
    }, 'Brand name already exists.');
  }
  async updateBrand(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateBrandDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    await this.assertBrand(organizationId, id);
    const value = await this.prisma.brand.update({ where: { id }, data: dto });
    await this.audit.record({
      userId: actor.id,
      action: 'BRAND_UPDATED',
      context,
      metadata: { brandId: id },
    });
    return value;
  }

  async products(userId: string, query: ProductQueryDto) {
    const organizationId = await this.organizationId(userId);
    if (query.branchId) await this.assertBranch(organizationId, query.branchId);
    const where: Prisma.ProductWhereInput = {
      organizationId,
      status: query.status,
      categoryId: query.categoryId,
      brandId: query.brandId,
      OR: query.search
        ? [
            { name: { contains: query.search, mode: 'insensitive' } },
            { sku: { contains: query.search, mode: 'insensitive' } },
            { barcode: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip: query.skip,
        take: query.pageSize,
        orderBy: { name: 'asc' },
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          stockLevels: {
            where: query.branchId ? { branchId: query.branchId } : undefined,
            include: {
              branch: { select: { id: true, code: true, name: true } },
            },
          },
          images: { orderBy: { position: 'asc' } },
          videos: { orderBy: { createdAt: 'asc' } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginate(data, total, query);
  }
  async product(userId: string, id: string) {
    const organizationId = await this.organizationId(userId);
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId },
      include: {
        category: true,
        brand: true,
        stockLevels: { include: { branch: true } },
        warrantyPolicies: true,
        images: { orderBy: { position: 'asc' } },
        videos: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }
  async createProduct(
    actor: AuthenticatedUser,
    dto: CreateProductDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    await this.validateProductRelations(
      organizationId,
      dto.categoryId,
      dto.brandId,
    );
    return this.unique(async () => {
      const value = await this.prisma.product.create({
        data: {
          name: dto.name,
          description: dto.description,
          categoryId: dto.categoryId,
          brandId: dto.brandId,
          costPrice: dto.costPrice,
          sellingPrice: dto.sellingPrice,
          taxRate: dto.taxRate,
          trackSerials: dto.trackSerials,
          reorderLevel: dto.reorderLevel,
          sku: dto.sku.trim().toUpperCase(),
          barcode: dto.barcode?.trim() || null,
          organizationId,
          images: dto.imageUrls?.length
            ? {
                create: dto.imageUrls.map((url, position) => ({
                  url,
                  position,
                })),
              }
            : undefined,
        },
      });
      await this.audit.record({
        userId: actor.id,
        action: 'PRODUCT_CREATED',
        context,
        metadata: { productId: value.id },
      });
      return value;
    }, 'SKU or barcode already exists.');
  }
  async updateProduct(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateProductDto,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    await this.product(actor.id, id);
    await this.validateProductRelations(
      organizationId,
      dto.categoryId,
      dto.brandId,
    );
    const { imageUrls, ...productData } = dto;
    const currentImages = imageUrls
      ? await this.prisma.productImage.findMany({ where: { productId: id } })
      : [];
    const retainedImageIds = new Set<string>();
    const value = await this.unique(
      () =>
        this.prisma.$transaction(async (tx) => {
          const product = await tx.product.update({
            where: { id },
            data: { ...productData, barcode: dto.barcode?.trim() || undefined },
          });
          if (imageUrls) {
            for (const [position, url] of imageUrls.entries()) {
              const existing = currentImages.find(
                (image) => image.url === url && !retainedImageIds.has(image.id),
              );
              if (existing) {
                retainedImageIds.add(existing.id);
                await tx.productImage.update({
                  where: { id: existing.id },
                  data: { position },
                });
              } else {
                await tx.productImage.create({
                  data: { productId: id, url, position },
                });
              }
            }
            await tx.productImage.deleteMany({
              where: {
                productId: id,
                id: {
                  in: currentImages
                    .filter((image) => !retainedImageIds.has(image.id))
                    .map((image) => image.id),
                },
              },
            });
          }
          return product;
        }),
      'Barcode already exists.',
    );
    if (imageUrls) {
      for (const image of currentImages.filter(
        (current) => !retainedImageIds.has(current.id),
      )) {
        await this.storage.remove(image.bucket, image.objectKey);
      }
    }
    await this.audit.record({
      userId: actor.id,
      action: 'PRODUCT_UPDATED',
      context,
      metadata: { productId: id },
    });
    return value;
  }

  async uploadProductImage(
    actor: AuthenticatedUser,
    productId: string,
    file: ProductUpload | undefined,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    await this.assertProduct(organizationId, productId);
    if (!file) throw new ConflictException('Select an image to upload.');
    const count = await this.prisma.productImage.count({
      where: { productId },
    });
    if (count >= 8)
      throw new ConflictException('A product can contain up to eight images.');
    const stored = await this.storage.uploadProductImage(productId, file);
    let image: ProductImage;
    try {
      image = await this.prisma.productImage.create({
        data: {
          productId,
          ...stored,
          position: count,
          altText: file.originalname,
        },
      });
    } catch (error) {
      await this.storage.remove(stored.bucket, stored.objectKey);
      throw error;
    }
    await this.audit.record({
      userId: actor.id,
      action: 'PRODUCT_IMAGE_UPLOADED',
      context,
      metadata: { productId, imageId: image.id },
    });
    return image;
  }

  async removeProductImage(
    actor: AuthenticatedUser,
    productId: string,
    imageId: string,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    await this.assertProduct(organizationId, productId);
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
    });
    if (!image) throw new NotFoundException('Product image not found.');
    await this.prisma.productImage.delete({ where: { id: image.id } });
    await this.storage.remove(image.bucket, image.objectKey);
    await this.audit.record({
      userId: actor.id,
      action: 'PRODUCT_IMAGE_REMOVED',
      context,
      metadata: { productId, imageId },
    });
    return { removed: true };
  }

  async uploadProductVideo(
    actor: AuthenticatedUser,
    productId: string,
    file: ProductUpload | undefined,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    await this.assertProduct(organizationId, productId);
    if (!file) throw new ConflictException('Select a video to upload.');
    if (await this.prisma.productVideo.count({ where: { productId } }))
      throw new ConflictException(
        'Remove the current product video before uploading another.',
      );
    const stored = await this.storage.uploadProductVideo(productId, file);
    let video: ProductVideo;
    try {
      video = await this.prisma.productVideo.create({
        data: { productId, ...stored },
      });
    } catch (error) {
      await this.storage.remove(stored.bucket, stored.objectKey);
      throw error;
    }
    await this.audit.record({
      userId: actor.id,
      action: 'PRODUCT_VIDEO_UPLOADED',
      context,
      metadata: { productId, videoId: video.id },
    });
    return video;
  }

  async removeProductVideo(
    actor: AuthenticatedUser,
    productId: string,
    videoId: string,
    context: SecurityRequestContext,
  ) {
    const organizationId = await this.organizationId(actor.id);
    await this.assertProduct(organizationId, productId);
    const video = await this.prisma.productVideo.findFirst({
      where: { id: videoId, productId },
    });
    if (!video) throw new NotFoundException('Product video not found.');
    await this.prisma.productVideo.delete({ where: { id: video.id } });
    await this.storage.remove(video.bucket, video.objectKey);
    await this.audit.record({
      userId: actor.id,
      action: 'PRODUCT_VIDEO_REMOVED',
      context,
      metadata: { productId, videoId },
    });
    return { removed: true };
  }

  private async validateProductRelations(
    org: string,
    categoryId?: string,
    brandId?: string,
  ) {
    if (categoryId) await this.assertCategory(org, categoryId);
    if (brandId) await this.assertBrand(org, brandId);
  }
  private async assertCategory(org: string, id: string) {
    if (
      !(await this.prisma.category.findFirst({
        where: { id, organizationId: org },
      }))
    )
      throw new NotFoundException('Category not found.');
  }
  private async assertBrand(org: string, id: string) {
    if (
      !(await this.prisma.brand.findFirst({
        where: { id, organizationId: org },
      }))
    )
      throw new NotFoundException('Brand not found.');
  }
  private async assertBranch(org: string, id: string) {
    if (
      !(await this.prisma.branch.findFirst({
        where: { id, organizationId: org },
      }))
    )
      throw new NotFoundException('Branch not found.');
  }
  private async assertProduct(org: string, id: string) {
    if (
      !(await this.prisma.product.findFirst({
        where: { id, organizationId: org },
      }))
    )
      throw new NotFoundException('Product not found.');
  }
  private async unique<T>(work: () => Promise<T>, message: string) {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(message);
      throw error;
    }
  }
}
