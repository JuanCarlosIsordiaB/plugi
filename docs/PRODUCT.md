# buscaPila product overview

buscaPila helps EV drivers find charging stations and decide where to charge based on recent community reports. The intended app targets iOS and Android. The current experience runs on the web.

## Find a charger

Drivers browse nearby stations on a map. At a wider zoom, groups show how many chargers are in the area. Zooming in reveals individual chargers when their coordinates are known. A station's panel shows its chargers, their status, and the age of the latest reports. Drivers can open the panel and return to the list without losing their place on the map.

## Share availability

Anyone signed in can report a charger as available, occupied, or out of service. Drivers can include an estimated duration when reporting occupancy. The map shows the countdown and marks the charger as available when the estimate ends, unless a newer report takes precedence. This is community-reported availability. The end of an estimate means the previous occupancy window elapsed.

## Contact a driver

A driver who needs a charger can look up a vehicle by its VIN or a unique Mexican license plate and send a message such as “Hello! How much longer will you be charging?” The recipient can reply, block the sender, or report the message. The app keeps names and email addresses private between the parties. Vehicle lookup and messaging work independently of a recorded charging session.

## Grow the station catalog

Administrators can add stations. Signed-in drivers can propose missing stations for administrator review. Catalog imports supplement community proposals where source listings are available.

## Planned experience

- Native iOS and Android screens for the core charging and contact flows.
- Camera-assisted vehicle lookup alongside manual entry.
- A dismissible shortcut that finds the nearest available charger while favoring recent reports.

For components, repository structure, API contracts, and the development workflow, see [Architecture](ARCHITECTURE.md).
