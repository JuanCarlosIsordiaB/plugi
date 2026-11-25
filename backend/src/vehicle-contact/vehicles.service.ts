import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Sessions } from '../auth/session.service.js';
import { consumeBudget, limited } from './contact-budget.js';
import { registration } from './input.js';
import { lockMexicanPlate } from './plate-contact.js';

const columns =
  'id, vin, plate, plate_country AS "plateCountry", plate_region AS "plateRegion"';
export interface Vehicle {
  id: string;
  vin: string;
  plate: string;
  plateCountry: string;
  plateRegion: string;
}

@Injectable()
export class Vehicles {
  constructor(@Inject(Sessions) private readonly sessions: Sessions) {}

  list(header?: string) {
    return this.sessions.authenticated(header, async (client, user) => ({
      vehicles: (
        await client.query<Vehicle>(
          'SELECT ' +
            columns +
            ' FROM contact_vehicles WHERE owner_id=$1 ORDER BY id',
          [user.id],
        )
      ).rows,
    }));
  }
  async add(header: string | undefined, input: unknown) {
    const allowed = await this.sessions.authenticated(header, (client, user) =>
      consumeBudget(client, 'registration', user.id, 10),
    );
    if (!allowed) limited();
    const vehicle = registration(input);
    return this.sessions.authenticated(header, async (client, user) => {
      if (vehicle.plateCountry === 'MX')
        await lockMexicanPlate(client, vehicle.plate);
      const result = await client.query<Vehicle>(
        `INSERT INTO contact_vehicles(id,owner_id,vin,plate,plate_country,plate_region)
         SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (
           SELECT 1 FROM contact_vehicles WHERE $5='MX' AND plate_country='MX'
             AND plate=$4 AND ($6='' OR plate_region='')
         ) ON CONFLICT DO NOTHING RETURNING ` + columns,
        [
          randomUUID(),
          user.id,
          vehicle.vin,
          vehicle.plate,
          vehicle.plateCountry,
          vehicle.plateRegion,
        ],
      );
      if (!result.rows[0])
        throw new ConflictException('Unable to register this vehicle.');
      return result.rows[0];
    });
  }
  remove(header: string | undefined, id: string) {
    return this.sessions.authenticated(header, async (client, user) => {
      const result = await client.query(
        'DELETE FROM contact_vehicles WHERE id=$1 AND owner_id=$2',
        [id, user.id],
      );
      if (!result.rowCount) throw new NotFoundException();
    });
  }
}
