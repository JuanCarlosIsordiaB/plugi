import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { Vehicles } from './vehicles.service.js';
import { Conversations } from './conversations.service.js';
import { ContactModeration } from './moderation.service.js';
import {
  VehiclesController,
  VehicleContactController,
  ContactReportsController,
} from './vehicle-contact.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [
    VehiclesController,
    VehicleContactController,
    ContactReportsController,
  ],
  providers: [Vehicles, Conversations, ContactModeration],
})
export class VehicleContactModule {}
