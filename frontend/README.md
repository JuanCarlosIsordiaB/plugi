# buscaPila frontend

The Expo SDK 58 app uses Expo Router. In a browser, drivers can explore charging stations, inspect chargers, submit status reports and station proposals, register their vehicles, and exchange private charging messages by plate or VIN. The native apps open to the buscaPila Home screen.

## Local development

From `frontend/`, install the locked dependencies and start Expo.

```powershell
npm.cmd ci
npm.cmd start
```

Use `npm.cmd run android`, `npm.cmd run ios`, or `npm.cmd run web` to start directly on a configured target. The iOS simulator requires macOS and Xcode.

For the web flow, start the NestJS API and its migrated PostgreSQL database, then run `npm.cmd run web -- --port 8081`. The browser calls `http://localhost:3000/api/v1` by default. Set `EXPO_PUBLIC_API_URL` before starting or exporting Expo to use another API base. Configure the API's `WEB_ORIGIN` to match the browser origin. This URL is public configuration. Access and refresh tokens live in browser memory and clear on reload. Map tiles come from OpenStreetMap.

## Project structure

- `src/app/` defines the routes and selects platform-specific screens.
- `src/charging/` implements the browser screens, map, and API client. The map requests the current viewport and filters returned stations by name or address.
- `src/contact/` implements vehicle registration, exact identifier lookup, the inbox, and conversations.
- `src/proposals/` implements station proposal submission and history.
- `public/` contains the local Figma icons and DM Sans font used in the browser.
- `app.json` configures Expo and references platform assets in `assets/`.

Run `npm.cmd run typecheck` and `npm.cmd run lint` to check changes.
