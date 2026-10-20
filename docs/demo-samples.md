# Demo samples: provenance

Every result in demo mode is one of the files below, served from `public/samples/`. All of them are original work made for this project, drawn in code by `scripts/demo-assets/scenes.mjs` and rendered by `scripts/demo-assets/render.mjs` (`node scripts/demo-assets/render.mjs all` rebuilds them all, reproducibly).

- **No AI generation:** no image or video model produced any of them; no output of Atlas Cloud or any other service is used.
- **No third-party material:** no photos, stock art, fonts embedded as outlines, logos, real works or real characters. Tsumugi, the paper-crane courier, is an original character for this demo.
- **No people:** nothing in the files depicts a real person.
- **Labelled:** each file carries a "DEMO SAMPLE · ORIGINAL ART" mark, and the app adds a "Demo data" chip wherever a sample is shown.
- **Licence:** © 2026 SolanaLink Co., Ltd., released under the repository's MIT licence.

| File | What it shows | How it was made | Size |
|---|---|---|---|
| `image-1.svg` | Key art: Tsumugi, an origami crane with an indigo braided-cord sash and a sealed letter, over a harbour town at dusk with paper lanterns and rain | `keyArt()`: SVG polygons, gradients and seeded rain | 1024 × 1024, vector |
| `image-2.svg` | A lantern-lit harbour street at night in the rain | `harbourStreet()` | 1024 × 1024, vector |
| `image-3.svg` | Braided cords (the kumihimo look) | `cords()` | 1024 × 1024, vector |
| `image-1-2x.jpg`, `image-2-2x.jpg`, `image-3-2x.jpg` | The same three pictures at 2048 px, returned by the upscaler in demo mode | the SVG above rasterised by headless Chromium at 2048 px, JPEG quality 86 | 2048 × 2048 |
| `video-1.mp4` | Wide shot: Tsumugi lifts off a wet tiled rooftop while lanterns flicker below | `shotWide(t, "a")`: 120 frames drawn at t = 0…5 s, captured by headless Chromium, encoded with ffmpeg (H.264, CRF 27) | 640 × 640, 5 s, 24 fps |
| `video-1-b.mp4` | Second take of the wide shot: night, flying the other way | `shotWide(t, "b")` | same |
| `video-2.mp4` | Close-up: the letter tucked under a wing while raindrops bead on the paper | `shotClose(t, "a")` | same |
| `video-2-b.mp4` | Second take of the close-up: light glints on the folds | `shotClose(t, "b")` | same |
| `video-3.mp4` | Tracking shot: Tsumugi glides low between moored boats toward a lit window | `shotTracking(t, "a")` | same |
| `video-3-b.mp4` | Second take of the tracking shot: night, lanterns on the masts | `shotTracking(t, "b")` | same |

Which file answers which request (`src/atlas/mock.ts`):

- **Text-to-image:** prompts about the crane (Tsumugi, crane, courier, origami) get `image-1.svg`; other prompts get `image-2.svg` or `image-3.svg`.
- **Image tool (upscale or restyle):** the 2048 px version of whichever picture came in.
- **Image-to-video:** the shot named in the prompt (wide, close-up, tracking). The example's own wording gets the first take, an edited prompt the second, so "edit one shot, re-run that branch" visibly changes that clip.
- **LLM rewrite:** a fixed original sentence built around the input (`mockRewrite`), streamed word by word.
- **Upload:** the picked file stays in the browser as its preview; the run uses `image-1.svg` in its place.
