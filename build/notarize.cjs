// electron-builder afterSign hook (v2, WS2-5).
//
// Notarizes the signed .app, but ONLY when Apple credentials are present in the
// environment — so a plain local `bun run dist` (no certs) still produces an
// unsigned, un-notarized build instead of failing. Notarization activates in CI /
// on a release machine that sets:
//   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
//
// Requires the @electron/notarize devDependency; if it isn't installed yet the
// hook logs and skips rather than breaking the build.

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[hearth] notarize: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set — skipping notarization')
    return
  }

  let notarize
  try {
    ;({ notarize } = require('@electron/notarize'))
  } catch {
    console.log('[hearth] notarize: @electron/notarize not installed — run `bun install` to enable notarization. Skipping.')
    return
  }

  const appName = context.packager.appInfo.productFilename
  console.log(`[hearth] notarizing ${appName}.app (team ${APPLE_TEAM_ID})…`)
  await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  })
  console.log('[hearth] notarization complete')
}
