/**
 * Version and product information for Mixarr
 * Update VERSION when releasing new versions (keep in sync with CHANGELOG.md)
 */

export const VERSION = '1.2.1';
export const LICENSE = 'GPL-3.0';
export const PRODUCT = 'Mixarr';

/**
 * Print startup banner with ASCII art logo
 */
export function printBanner(): void {
  const versionLine = `  Version: v${VERSION}`.padEnd(30) + `License: ${LICENSE}`.padEnd(28);
  const banner = `
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   __  __ _                                               ║
║  |  \\/  (_)_  ____ _ _ __ _ __                           ║
║  | |\\/| | \\ \\/ / _\` | '__| '__|                          ║
║  | |  | | |>  < (_| | |  | |                             ║
║  |_|  |_|_/_/\\_\\__,_|_|  |_|                             ║
║                                                          ║
║  Music Discovery for Lidarr                              ║
║                                                          ║
║${versionLine}║
╚══════════════════════════════════════════════════════════╝
`;
  console.log(banner);
}
