# buscaPila frontend

The React Native app uses Expo SDK 58 and Expo Router. It opens to a single Home screen.

## Local development

From `frontend/`, install the locked dependencies and start Expo.

```powershell
npm.cmd ci
npm.cmd start
```

Use `npm.cmd run android`, `npm.cmd run ios`, or `npm.cmd run web` to start directly on a configured target. The iOS simulator requires macOS and Xcode.

## Project structure

- `src/app/_layout.tsx` defines the root navigator and follows the system color scheme.
- `src/app/index.tsx` defines the Home screen.
- `app.json` configures Expo and references platform assets in `assets/`.

Run `npm.cmd run typecheck` and `npm.cmd run lint` to check changes.
