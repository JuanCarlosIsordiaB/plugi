import type { PoolClient } from 'pg';
import type { AuthSecrets } from '../auth/credentials.js';

const validityMs = 10 * 60 * 1000;
const purpose = 'mx-plate-contact-v1';

// Serialize new Mexican registrations with compact lookup and token delivery,
// including inserts for a currently missing plate in another region.
export async function lockMexicanPlate(client: PoolClient, plate: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'mx-plate:' + plate,
  ]);
}

export async function uniqueMexicanRegistration(
  client: PoolClient,
  plate: string,
) {
  await lockMexicanPlate(client, plate);
  const { rows } = await client.query<{
    id: string;
    owner_id: string;
    accepts_contact: boolean;
  }>(
    `SELECT id, owner_id, accepts_contact FROM contact_vehicles
     WHERE plate_country='MX' AND plate=$1 LIMIT 2 FOR SHARE`,
    [plate],
  );
  if (rows.length === 1 && rows[0].accepts_contact) return rows[0];
}

export function issueContactToken(
  secrets: AuthSecrets,
  caller: string,
  registration: string,
  plate: string,
) {
  return secrets.seal(
    [purpose, caller, registration, plate, Date.now() + validityMs].join(':'),
  );
}

export function readContactToken(
  secrets: AuthSecrets,
  token: string,
  caller: string,
) {
  // Require the full 128-bit GCM tag before passing untrusted input to open().
  if (
    !/^[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{22}==\.[A-Za-z0-9+/]+={0,2}$/.test(
      token,
    )
  )
    return;
  let payload: string;
  try {
    payload = secrets.open(token);
  } catch {
    return;
  }
  const [scope, sender, registration, plate, until, ...extra] =
    payload.split(':');
  if (
    scope === purpose &&
    sender === caller &&
    !extra.length &&
    Number(until) > Date.now()
  ) {
    return { registration, plate };
  }
}
