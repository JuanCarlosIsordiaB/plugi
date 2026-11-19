import { type FormEvent, useState } from 'react';
import { authenticated, jsonRequest } from '../charging/api';
import { Feedback, useResource } from '../charging/ui.web';
import { ContactPage, IdentifierFields, readIdentifier, useAction, type VehicleInput } from './common.web';

interface Vehicle extends VehicleInput { id: string }

function Garage() {
  const vehicles = useResource<{ vehicles: Vehicle[] }>('/vehicles', true);
  const add = useAction();
  const remove = useAction();
  const [removing, setRemoving] = useState('');
  const [notice, setNotice] = useState('');

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = readIdentifier(form);
    setNotice('');
    void add.run(signal => authenticated<Vehicle>('/vehicles', { ...jsonRequest('POST', payload), signal }), () => {
      form.reset();
      setNotice('Vehicle added.');
      vehicles.retry();
    });
  }
  function removeVehicle(id: string) {
    setNotice('');
    void remove.run(signal => authenticated<void>('/vehicles/' + encodeURIComponent(id), { method: 'DELETE', signal }), () => {
      setRemoving('');
      setNotice('Vehicle removed.');
      vehicles.retry();
    });
  }
  return <>
    {notice && <p className="bp-success" role="status">{notice}</p>}
    <section className="bc-card">
      <h2>Registered vehicles</h2>
      {!vehicles.data ? <Feedback {...vehicles} loading="Loading your vehicles…" /> :
        vehicles.data.vehicles.length === 0 ? <p className="bp-muted">You haven’t registered a vehicle yet.</p> :
          <ul>{vehicles.data.vehicles.map(vehicle => <li className="bc-row" key={vehicle.id}>
            <strong>{vehicle.plate} · {vehicle.plateRegion}, {vehicle.plateCountry}</strong>
            <p className="bp-muted">VIN ending in {vehicle.vin.slice(-4)}</p>
            {removing === vehicle.id ? <>
              <p>Remove this vehicle from your account? Drivers will lose the option to contact you through this registration.</p>
              {remove.error && <p className="bp-error" role="alert">{remove.error}</p>}
              <div className="bc-actions"><button className="bp-secondary" disabled={remove.pending} onClick={() => removeVehicle(vehicle.id)}>
                {remove.pending ? 'Removing…' : 'Confirm removal'}</button>
                <button className="bp-text" disabled={remove.pending} onClick={() => setRemoving('')}>Cancel</button></div>
            </> : <div><button className="bp-text" disabled={remove.pending} onClick={() => {
              remove.clearError(); setRemoving(vehicle.id);
            }}>Remove vehicle<span className="bp-screen-reader"> {vehicle.plate}</span></button></div>}
          </li>)}</ul>}
    </section>
    <form className="bp-form bc-card" onSubmit={register}>
      <h2>Register a vehicle</h2>
      <p className="bp-muted">Register a vehicle you own. Other drivers can use its exact plate and issuing location or VIN to send you a charging message. Ownership is self-declared.</p>
      <fieldset disabled={add.pending}><legend className="bp-screen-reader">Vehicle identifiers</legend><IdentifierFields method="both" /></fieldset>
      {add.error && <p className="bp-error" role="alert">{add.error}</p>}
      <button className="bp-primary" disabled={add.pending}>{add.pending ? 'Adding…' : 'Add vehicle'}</button>
    </form>
  </>;
}

export default function Vehicles() {
  return <ContactPage title="My vehicles" path="/vehicles" introduction="Sign in to register a vehicle or manage your registrations."><Garage /></ContactPage>;
}
