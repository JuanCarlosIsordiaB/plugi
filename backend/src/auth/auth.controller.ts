import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { Challenges } from './challenge.service.js';
import {
  bodyFields,
  emailField,
  newPassword,
  otp,
  resetToken,
  stringField,
} from './input.js';
import { AuthLimit, Limit } from './limits.js';
import { Sessions } from './session.service.js';

@Controller('api/v1/auth')
@UseGuards(AuthLimit)
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Sessions) private readonly sessions: Sessions,
    @Inject(Challenges) private readonly challenges: Challenges,
  ) {}

  @Post('sign-up')
  @Limit('signup', 5, 3600, 3)
  signup(@Body() input: unknown) {
    const data = bodyFields(input, ['name', 'email', 'password']);
    return this.auth.signup(
      stringField(data.name, 'name').trim(),
      emailField(data.email),
      newPassword(data.password),
    );
  }

  @Post('sign-in')
  @HttpCode(200)
  @Limit('signin', 5, 60, 10)
  signIn(@Body() input: unknown, @Headers('user-agent') agent?: string) {
    const data = bodyFields(input, ['email', 'password']);
    return this.auth.signIn(
      emailField(data.email),
      stringField(data.password, 'password'),
      agent,
    );
  }

  @Get('verify-email/challenge')
  emailChallenge(@Headers('x-challenge-id') id?: string) {
    return this.challenges.info(id, 'account_confirmation');
  }

  @Post('verify-email/:code')
  @Limit('verify-email', 5, 900)
  verifyEmail(
    @Param('code') code: string,
    @Headers('x-challenge-id') id?: string,
    @Headers('user-agent') agent?: string,
  ) {
    return this.auth.verifyEmail(id, otp(code), agent);
  }

  @Get('2fa/challenge')
  twoFactorChallenge(@Headers('x-challenge-id') id?: string) {
    return this.challenges.info(id, '2fa');
  }

  @Post('2fa/sign-in/:code')
  @HttpCode(200)
  @Limit('verify-login-totp', 5, 600)
  secondFactor(
    @Param('code') code: string,
    @Headers('x-challenge-id') id?: string,
    @Headers('user-agent') agent?: string,
  ) {
    return this.auth.secondFactor(id, otp(code), agent);
  }

  @Post('forgot-password')
  @Limit('forgot-password', 3, 300, 3)
  forgot(@Body() input: unknown) {
    return this.auth.forgot(emailField(bodyFields(input, ['email']).email));
  }

  @Get('reset-password/challenge')
  resetChallenge(@Headers('x-challenge-id') id?: string) {
    return this.challenges.info(id, 'password_reset');
  }

  @Get('reset-password/verify/:token')
  @Limit('reset-code', 10, 900)
  verifyReset(
    @Param('token') token: string,
    @Headers('x-challenge-id') id?: string,
  ) {
    return this.challenges.verifyReset(id, resetToken(token));
  }

  @Post('reset-password/:token')
  @Limit('reset-code', 10, 900)
  reset(
    @Param('token') token: string,
    @Body() input: unknown,
    @Headers('x-challenge-id') id?: string,
  ) {
    return this.auth.resetPassword(
      id,
      resetToken(token),
      newPassword(bodyFields(input, ['password']).password),
    );
  }

  @Post('refresh')
  refresh(@Headers('authorization') header?: string) {
    return this.sessions.refresh(header);
  }

  @Get('session')
  current(@Headers('authorization') header?: string) {
    return this.sessions.current(header);
  }

  @Post('logout')
  logout(@Headers('authorization') header?: string) {
    return this.sessions.logout(header);
  }
}
