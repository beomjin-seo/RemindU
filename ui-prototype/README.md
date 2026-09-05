# Screenshot UI prototype

A standalone static UI concept for screenshot browsing. This directory is independent of the existing backend and iOS applications; no backend integration or dependency installation is required.

## Preview

Run from this directory:

```sh
python3 -m http.server 4190 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4190/`.

- `index.html`: opens the dark concept.
- `dark.html`: animated dark prototype.
- `dark.html?view=detail`: opens a sample detail screen.
- `dark-board.html`: side-by-side storyboard.

The dark prototype includes a scattered-card gathering sequence, a three-column feed, thumbnail-to-detail transitions, scrollable details, sample AI summaries and evidence, local-format capture dates, and up to three candidate links. Confidence colors are orange at 0–30%, yellow at 31–70%, and green at 71–100%. Reduced-motion preferences are respected.

## Sample content

All AI summaries, confidence percentages, capture timestamps, and candidate matches are design fixtures, not real analysis or photo-library metadata. Sample images are from the Unsplash image CDN. Source image identifiers are recorded in `dark.js`. The editorial overlays were created for this concept and are not screenshots of real websites. Links open the original sample images or related Unsplash image searches.

## Sharing

Publishing the directory contents through a static hosting service provides a browser link requiring no Codex installation. GitHub repository file views do not execute this prototype. A repository administrator can configure an appropriate static-site deployment that publishes **only this directory**. Publishing or changing the visibility of the repository is not part of this addition.
