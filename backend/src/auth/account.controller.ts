import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Accounts, type ProfileUpdate } from './account.service.js';
import { AuthService } from './auth.service.js';
import { bodyFields, newPassword, otp, stringField } from './input.js';
import { AuthLimit, Limit } from './limits.js';
import { TotpService } from './totp.service.js';

@Controller('api/v1/account')
@UseGuards(AuthLimit)
export class AccountController {
  constructor(
    @Inject(Accounts) private readonly accounts: Accounts,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TotpService) private readonly totp: TotpService,
  ) {}

  @Get('profile')
  profile(@Headers('authorization') header?: string) {
    return this.accounts.profile(header);
  }

  @Put('profile')
  update(@Body() input: unknown, @Headers('authorization') header?: string) {
    const fields = [
      'name',
      'lastName',
      'avatar',
      'country',
      'language',
    ] as const;
    const data = bodyFields(input, fields);
    if (Object.keys(data).length === 0)
      throw new BadRequestException('Provide a profile field.');
    const update: ProfileUpdate = {};
    for (const field of fields) {
      if (data[field] !== undefined)
        update[field] = stringField(
          data[field],
          field,
          field === 'avatar' ? 2048 : 128,
        ).trim();
    }
    return this.accounts.update(header, update);
  }

  @Put('profile/password')
  @Limit('change-password', 5, 300)
  password(@Body() input: unknown, @Headers('authorization') header?: string) {
    const data = bodyFields(input, ['currentPassword', 'newPassword']);
    return this.auth.changePassword(
      header,
      stringField(data.currentPassword, 'current password'),
      newPassword(data.newPassword),
    );
  }

  @Get('sessions')
  sessions(@Headers('authorization') header?: string) {
    return this.accounts.list(header);
  }

  @Post('sessions/delete-all')
  removeAll(@Headers('authorization') header?: string) {
    return this.accounts.remove(header);
  }

  @Delete('sessions/:sessionId')
  remove(
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('authorization') header?: string,
  ) {
    return this.accounts.remove(header, id);
  }

  @Post('2fa/enable')
  @Limit('setup-totp', 5, 300)
  setup(@Headers('authorization') header?: string) {
    return this.totp.setup(header);
  }

  @Post('2fa/verify/:code')
  @Limit('manage-totp', 5, 300)
  verify(
    @Param('code') code: string,
    @Headers('authorization') header?: string,
  ) {
    return this.totp.change(header, otp(code), true);
  }

  @Post('2fa/disable/:code')
  @Limit('manage-totp', 5, 300)
  disable(
    @Param('code') code: string,
    @Headers('authorization') header?: string,
  ) {
    return this.totp.change(header, otp(code), false);
  }
}
