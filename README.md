# Guesslytics - GeoGuessr Rating Tracker

Tracks your GeoGuessr competitive duel ratings over time and displays it in a graph.

<br>

[![Install with Tampermonkey](https://img.shields.io/badge/Install%20with-Tampermonkey-black?logo=Tampermonkey&logoColor=white&style=for-the-badge)](https://raw.githubusercontent.com/Avanatiker/Guesslytics/master/guesslytics.user.js)

## Features ⚡

- Track your GeoGuessr competitive duel ratings over time
- Display ratings in an interactive graph with pan and zoom
- View statistics about your performance
- Customize the display with various settings
- Automatically sync with your GeoGuessr account

## Preview

<img alt="Minimal Stats" src="https://cdn.discordapp.com/attachments/1358135660267045114/1396686472324845679/image.png?ex=6888e064&amp;is=68878ee4&amp;hm=b9ba79877005b205d39b62f09350762b03f1ca806b9a080fcf3970c31549eee7&amp;" width="40%"/>
<img alt="Advanced Stats" src="https://cdn.discordapp.com/attachments/1358135660267045114/1396686472635093062/image.png?ex=6888e064&amp;is=68878ee4&amp;hm=131d9f0068fa446ef35012e2803a63d62e3a0f54f863e6ca2b6b9c437827b8ed&amp;" width="40%"/>
<img alt="Settings" src="https://cdn.discordapp.com/attachments/1358135660267045114/1396686472928563350/image.png?ex=6888e064&amp;is=68878ee4&amp;hm=a4d0c1ab9447de950dfe1ae6f50fd06cf445a45fddc681e2d629e77a73910f62&amp;" width="20%"/>

## 🛠️ Installation

To use this script, you first need a **userscript manager**. This is a browser extension that manages and runs scripts like Guesslytics.

1.  **Install a Userscript Manager**
    -   **Firefox**: [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/) or [Greasemonkey](https://addons.mozilla.org/firefox/addon/greasemonkey/)
    -   **Chrome**: [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
    -   **Other browsers**: Find the right version of Tampermonkey for [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd), [Opera](https://addons.opera.com/extensions/details/tampermonkey-beta/), or [Safari](https://www.tampermonkey.net/?browser=safari).

2.  **Install the Guesslytics Script**
    -   Click the **"Install with Tampermonkey"** button below.
    -   Your userscript manager will open a new tab.
    -   Click the **"Install"** button on that page.

[![Install with Tampermonkey](https://img.shields.io/badge/Install%20with-Tampermonkey-black?logo=Tampermonkey&logoColor=white&style=for-the-badge)](https://raw.githubusercontent.com/Avanatiker/Guesslytics/master/guesslytics.user.js)

## Development 👨‍💻

This project is built with:

- [TypeScript](https://www.typescriptlang.org) for type safety
- [Rolldown](https://rolldown.rs) for bundling and minification
- [Chart.js](https://www.chartjs.org/) for data visualization

### Getting Started

```bash
git clone https://github.com/Avanatiker/Guesslytics && cd Guesslytics && yarn && yarn dev
```

### Development Commands

- `yarn dev` - Start the development server with auto-reload
- `yarn build` - Build the production script
- `yarn lint` - Run the linter

### Project Structure

- `src/index.ts` - Main entry point
- `src/lib/` - Utility modules
  - `api.ts` - API-related functions
  - `constants.ts` - Constants and configuration
  - `ui.ts` - UI-related functions
  - `utils.ts` - Helper functions
- `src/types/` - TypeScript type definitions
  - `index.ts` - Main type definitions
  - `global.d.ts` - Global ambient declarations

## Future Improvements

- Support Team Duels mode
- Add unit tests for critical functionality
- Improve error handling for API requests
- Add more detailed documentation for each module
- Consider using a state management pattern for better data flow
- Add localization support for multiple languages
