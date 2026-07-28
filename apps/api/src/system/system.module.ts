import {
  Controller,
  Get,
  Header,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../auth/jwt.guard';

@Controller('health')
class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Header('Cache-Control', 'no-store')
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Header('Cache-Control', 'no-store')
  @Get('ready')
  async ready() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('数据库尚未就绪');
    }
  }
}

@Module({ controllers: [HealthController] })
export class SystemModule {}
