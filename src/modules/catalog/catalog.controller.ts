import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { getSecurityRequestContext } from '../../common/security/request';
import { CatalogService } from './catalog.service';
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
}
