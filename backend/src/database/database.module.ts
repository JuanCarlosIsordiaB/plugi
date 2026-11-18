import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { readPostgresConfig } from './database.config.js';
import { DatabaseService } from './database.service.js';

@Module({
  providers: [
    {
      provide: DatabaseService,
      useFactory: () =>
        new DatabaseService(new Pool(readPostgresConfig(process.env))),
    },
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
