import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ActivateWarrantyDto } from './dto/warranty.dto';
import { WarrantiesService } from './warranties.service';
@Controller('qr')
export class QrController {
  constructor(private readonly warranties: WarrantiesService) {}
  @Get('product/:token') scan(@Param('token') token: string) {
    return this.warranties.scan(token);
  }
  @Post('warranty/activate') activate(@Body() dto: ActivateWarrantyDto) {
    return this.warranties.activate(dto.token);
  }
}
