import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { bodyFields } from '../auth/input.js';
import { Vehicles } from './vehicles.service.js';
import { Conversations } from './conversations.service.js';
import { ContactModeration } from './moderation.service.js';
import { choice } from './input.js';

const uuid = new ParseUUIDPipe({ version: '4' });
const cursor = new ParseUUIDPipe({ version: '4', optional: true });

@Controller('api/v1/vehicles')
export class VehiclesController {
  constructor(@Inject(Vehicles) private readonly vehicles: Vehicles) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Headers('authorization') header?: string) {
    return this.vehicles.list(header);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  add(@Body() input: unknown, @Headers('authorization') header?: string) {
    return this.vehicles.add(header, input);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id', uuid) id: string,
    @Headers('authorization') header?: string,
  ) {
    return this.vehicles.remove(header, id);
  }
}

@Controller('api/v1/vehicle-contact')
export class VehicleContactController {
  constructor(
    @Inject(Conversations) private readonly conversations: Conversations,
    @Inject(ContactModeration) private readonly moderation: ContactModeration,
  ) {}
  @Post()
  @HttpCode(202)
  start(@Body() input: unknown, @Headers('authorization') header?: string) {
    return this.conversations.start(header, input);
  }

  @Post('lookup')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  lookup(
    @Body() input: unknown,
    @Ip() ip: string,
    @Headers('authorization') header?: string,
  ) {
    return this.conversations.lookup(header, input, ip);
  }

  @Get('conversations')
  @Header('Cache-Control', 'no-store')
  inbox(
    @Query('before', cursor) before?: string,
    @Headers('authorization') header?: string,
  ) {
    return this.conversations.list(header, before);
  }

  @Get('conversations/:id')
  @Header('Cache-Control', 'no-store')
  read(
    @Param('id', uuid) id: string,
    @Query('before', cursor) before?: string,
    @Headers('authorization') header?: string,
  ) {
    return this.conversations.read(header, id, before);
  }

  @Post('conversations/:id/replies')
  @Header('Cache-Control', 'no-store')
  reply(
    @Param('id', uuid) id: string,
    @Body() input: unknown,
    @Headers('authorization') header?: string,
  ) {
    return this.conversations.reply(header, id, input);
  }

  @Post('conversations/:id/block')
  @HttpCode(204)
  block(
    @Param('id', uuid) id: string,
    @Headers('authorization') header?: string,
  ) {
    return this.conversations.block(header, id);
  }

  @Post('messages/:id/report')
  @HttpCode(204)
  report(
    @Param('id', uuid) id: string,
    @Body() input: unknown,
    @Headers('authorization') header?: string,
  ) {
    const reason = choice(bodyFields(input, ['reason']).reason, [
      'abuse',
      'spam',
      'other',
    ]);
    return this.moderation.report(header, id, reason);
  }
}

@Controller('api/v1/admin/vehicle-contact/reports')
export class ContactReportsController {
  constructor(
    @Inject(ContactModeration) private readonly moderation: ContactModeration,
  ) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  queue(@Headers('authorization') header?: string) {
    return this.moderation.queue(header);
  }
  @Post(':id/resolve')
  @HttpCode(204)
  resolve(
    @Param('id', uuid) id: string,
    @Body() input: unknown,
    @Headers('authorization') header?: string,
  ) {
    const action = choice(bodyFields(input, ['action']).action, [
      'dismiss',
      'hide',
      'suspend',
    ]);
    return this.moderation.resolve(header, id, action);
  }
}
