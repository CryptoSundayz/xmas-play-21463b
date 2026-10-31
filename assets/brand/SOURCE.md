# Official Optimum brand files (originals, unmodified)

Downloaded 31 Oct 2026 from Optimum's brand assets page
https://getoptimum.notion.site/Optimum-Brand-Assets-1a6fe54341398098843bc5847670e5ed
via Notion's public endpoints (`loadPageChunk` -> `queryCollection` on the "Logos & Colors" gallery -> `/signed/attachment:...`).

| File | Gallery entry | Notion attachment |
|---|---|---|
| optimum-icon-white.svg / .png | Light Icon | f8d38dcd-deae-4d5a-92e4-0ec859613cbf / 56030c69-855f-443d-abe7-90a60175f832 |
| optimum-icon-black.svg / .png | Dark Icon | edfa2e7f-0ff6-400c-8539-7def8238dbe5 / b21614a3-77b0-4e99-8127-453fe86c5e6f |
| optimum-logo-white.svg / .png | Light Wordmark | 3467174f-eb4c-4cfb-9eba-b9d73f6034ad / 624a9d36-fb1a-44a8-bea8-3da6e9fe3823 |
| optimum-logo-black.svg / .png | Dark Wordmark | 32e3f147-0bf4-423e-86b3-bfea4a0cf761 / ab5d25d0-0996-4edb-b03b-a906792e78c3 |
| Optimum_Brand-Guidelines.pdf | file block on the page (MAR '26) | 7ca8805b-8904-41af-a4c7-316da4e0e302 |

## How the game uses it
`src/logo.js` `LOGO_D` / `LOGO_VB` is the single `<path d>` of `optimum-icon-white.svg` copied byte-for-byte
(viewBox 900x485; verified identical to the Notion download). Everything derives from it:
- validator house sign: `THREE.ShapeGeometry` of the path (exact silhouette) + blurred halo (world.js `mountSign`)
- HUD / title / ending: inline SVG of the same path (`logoSVG`)
- fireworks-logo ending + pickup ring: points sampled along the path (`logoPoints`) / `makeLogoMesh`

## Brand-rule notes (from the guidelines PDF, "Logo don'ts")
Don't stretch/distort, rotate, change colour, apply drop shadows, apply gradients, or change the logo.
- The mark itself is rendered in Alabaster #FFFBFB (official palette, not recoloured); uniform scale only; the pickup billboard's wobble rotation was removed.
- The requested "neon blue glow" is a light halo *behind* the mark in the palette's Azure #51B1FE. Strictly this is close to the "drop shadow" don't; it was kept because Daniel asked for neon glow. Flag to Optimum if this is for official use.
