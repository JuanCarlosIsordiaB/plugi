import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthMail } from './auth-mail.service.js';
import { AuthService } from './auth.service.js';
import { Accounts } from './account.service.js';
import { AccountController } from './account.controller.js';
import { AuthSecrets } from './credentials.js';
import { AuthLimit } from './limits.js';
import { Sessions } from './session.service.js';
import { Challenges } from './challenge.service.js';
import { TotpService } from './totp.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController, AccountController],
  providers: [
    AuthMail,
    AuthService,
    AuthSecrets,
    AuthLimit,
    Sessions,
    Challenges,
    Accounts,
    TotpService,
  ],
})
export class AuthModule {}
