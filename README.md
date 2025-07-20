# Guesslytics - GeoGuessr Rating Tracker

Tracks your GeoGuessr competitive duel ratings over time and displays it in a graph.

## Features ⚡

- Track your GeoGuessr competitive duel ratings over time
- Display ratings in an interactive graph with pan and zoom
- View statistics about your performance
- Customize the display with various settings
- Automatically sync with your GeoGuessr account

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
