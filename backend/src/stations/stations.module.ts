import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { StationProposals } from './station-proposals.service.js';
import { StationsController } from './stations.controller.js';
import { Stations } from './stations.service.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  providers: [Stations, StationProposals],
  controllers: [StationsController],
})
export class StationsModule {}
