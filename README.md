# Interactive Pixmap Viewer

Interactive Pixmap Viewer is a React + Vite playground tailored for exploring Netpbm images (PPM/PGM) alongside common raster formats. It features drag-and-drop uploads, live color sampling with a hover tooltip, and a synchronized editable text representation for Netpbm files so changes reflect in real time.

## Getting Started

The project uses npm scripts for all common tasks:

- `npm install` – install dependencies.
- `npm run dev` – start the Vite dev server with hot reloading.
- `npm run build` – generate a production build in `dist/`.
- `npm run preview` – serve the bundled build locally for smoke testing.
- `npm run deploy` – publish the current build to GitHub Pages (expects proper repo setup).

Drop your own `.ppm` or `.pgm` images into the app or paste a P2/P3 Netpbm snippet into the editor to experiment with pixel data on the fly.
