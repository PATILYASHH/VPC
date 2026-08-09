# Versioning

VPC tracks three independent version numbers instead of one global one. Bump only the track that the change actually touches — a taskbar tweak shouldn't force a platform version bump, and a new backend module shouldn't force a UI bump.

Source of truth: [frontend/src/lib/version.js](frontend/src/lib/version.js) (mirrored in root `package.json` for `VPC_VERSION`). Displayed live in System Settings → Server Info.

| Track | Name | Current | Covers |
|---|---|---|---|
| Platform | **VPC** | 13.0.0 | Ecosystem-wide releases — installer, backend apps/routes/migrations, cross-cutting features (e.g. Notify, DB, Web Hosting) |
| Shell | **VPC OS** | 3.5.0 | The desktop environment itself — window manager, taskbar, launcher, desktop icon grid, app registry (`frontend/src/components/desktop/**`, `stores/useDesktopStore.js`, `stores/useWindowStore.js`) |
| Design system | **VPCUI** | 1.0.0 | Shared UI/component layer used across apps (`frontend/src/components/ui/**`, shared styling/tokens) |

## Bump rules

- Changed a desktop-shell file (window/taskbar/launcher/app registry)? Bump **VPC OS** (minor for new capability, patch for fixes).
- Changed a shared UI primitive or design token used by multiple apps? Bump **VPCUI**.
- Shipped a new app, backend feature, or anything cutting across shell + apps? Bump **VPC** (this is the one referenced by the installer and release notes).
- A single change can bump more than one track if it genuinely spans layers — don't force it into just one.

This is separate from the **VPC Sync** VS Code extension / CLI versions (`vscode-extension/package.json`, `cli/**`), which ship and version independently since they're distributed outside the server.
