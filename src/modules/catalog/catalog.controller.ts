import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { getSecurityRequestContext } from '../../common/security/request';
import { CatalogService } from './catalog.service';
import type { ProductUpload } from '../storage/storage.service';
import {
  CreateBrandDto,
  CreateCategoryDto,
  CreateProductDto,
  ProductQueryDto,
  UpdateBrandDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './dto/catalog.dto';

@Controller('catalog')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}
  @Get('categories') @RequirePermissions('products:view') categories(
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.catalog.categories(u.id);
  }
  @Post('categories') @RequirePermissions('products:manage') createCategory(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreateCategoryDto,
    @Req() r: Request,
  ) {
    return this.catalog.createCategory(u, d, getSecurityRequestContext(r));
  }
  @Patch('categories/:id')
  @RequirePermissions('products:manage')
  updateCategory(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() d: UpdateCategoryDto,
    @Req() r: Request,
  ) {
    return this.catalog.updateCategory(u, id, d, getSecurityRequestContext(r));
  }
  @Get('brands') @RequirePermissions('products:view') brands(
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.catalog.brands(u.id);
  }
  @Post('brands') @RequirePermissions('products:manage') createBrand(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreateBrandDto,
    @Req() r: Request,
  ) {
    return this.catalog.createBrand(u, d, getSecurityRequestContext(r));
  }
  @Patch('brands/:id') @RequirePermissions('products:manage') updateBrand(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() d: UpdateBrandDto,
    @Req() r: Request,
  ) {
    return this.catalog.updateBrand(u, id, d, getSecurityRequestContext(r));
  }
  @Get('products') @RequirePermissions('products:view') products(
    @CurrentUser() u: AuthenticatedUser,
    @Query() q: ProductQueryDto,
  ) {
    return this.catalog.products(u.id, q);
  }
  @Get('products/:id') @RequirePermissions('products:view') product(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.catalog.product(u.id, id);
  }
  @Post('products') @RequirePermissions('products:manage') createProduct(
    @CurrentUser() u: AuthenticatedUser,
    @Body() d: CreateProductDto,
    @Req() r: Request,
  ) {
    return this.catalog.createProduct(u, d, getSecurityRequestContext(r));
  }
  @Patch('products/:id') @RequirePermissions('products:manage') updateProduct(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Body() d: UpdateProductDto,
    @Req() r: Request,
  ) {
    return this.catalog.updateProduct(u, id, d, getSecurityRequestContext(r));
  }

  @Post('products/:id/images')
  @RequirePermissions('products:manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }),
  )
  uploadProductImage(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: ProductUpload | undefined,
    @Req() r: Request,
  ) {
    return this.catalog.uploadProductImage(
      u,
      id,
      file,
      getSecurityRequestContext(r),
    );
  }

  @Delete('products/:id/images/:imageId')
  @RequirePermissions('products:manage')
  removeProductImage(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Req() r: Request,
  ) {
    return this.catalog.removeProductImage(
      u,
      id,
      imageId,
      getSecurityRequestContext(r),
    );
  }

  @Post('products/:id/video')
  @RequirePermissions('products:manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }),
  )
  uploadProductVideo(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: ProductUpload | undefined,
    @Req() r: Request,
  ) {
    return this.catalog.uploadProductVideo(
      u,
      id,
      file,
      getSecurityRequestContext(r),
    );
  }

  @Delete('products/:id/video/:videoId')
  @RequirePermissions('products:manage')
  removeProductVideo(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id') id: string,
    @Param('videoId') videoId: string,
    @Req() r: Request,
  ) {
    return this.catalog.removeProductVideo(
      u,
      id,
      videoId,
      getSecurityRequestContext(r),
    );
  }
}
