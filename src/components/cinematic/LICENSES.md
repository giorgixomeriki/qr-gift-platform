# Third-party code in the cinematic opening

Verified 2026-11-28 from each repository's LICENSE file (GitHub API).

| Used | Source | License | How |
|---|---|---|---|
| Memory Galaxy (`memory-galaxy.tsx`, `memory-galaxy.css`) | React Bits DomeGallery — https://github.com/DavidHDev/react-bits/tree/main/src/ts-default/Components/DomeGallery (demo https://reactbits.dev/components/dome-gallery) | MIT + Commons Clause | Source adapted (sphere placement, radius fit, drag + inertia). Commercial use inside a product is permitted; selling/redistributing the components themselves is not. Notice kept below and in the file header. |
| Petal flight model + outline (`engine.ts`, `textures.ts`) | Opus Motion Library falling-petals — https://github.com/govindusasanka/opus-motion-library/blob/main/src/motions/environment/falling-petals.tsx (demo https://govindusasanka.github.io/opus-motion-library/motion/falling-petals/) | MIT | Depth layers, sway, spin and 3D flip model and petal path ported from Remotion/SVG to a GPU shader; flat fill replaced by shaded procedural texture. |
| Stardust field (`engine.ts`) | three.js examples/webgl_points_sprites.html — https://github.com/mrdoob/three.js/blob/dev/examples/webgl_points_sprites.html | MIT | Layered Points + parameter table + counter-rotation + HSL colour; snowflake PNGs NOT used (procedural gold sprites). |
| `three` 0.187.0 (npm) | https://github.com/mrdoob/three.js | MIT | Runtime dependency (lazy chunk). |
| `@use-gesture/react` 10.3.1 (npm) | https://github.com/pmndrs/use-gesture | MIT | Drag for the Memory Galaxy (DomeGallery's own dependency). |
| `gsap` 3.15.0, `motion` 12.43.0 | already dependencies | GSAP standard "no charge" license; MIT | GSAP orchestrates the timeline. No new install. |

Rejected: `wake-bikila-dev/rose_flower` and `jpmadrigal07/flower-bloom` (no license file → no reuse permission); React Bits CircularGallery (needs `ogl`, a second WebGL library; DomeGallery is closer to the reference ring); tsParticles (MIT, but three.js Points already covers the dust — a second particle engine would add ~40–60 KB for nothing). No textures, models, photos, fonts or music were copied from any source or from the reference video; all imagery is procedural or synthetic.

---

MIT + Commons Clause License Condition v1.0

Copyright (c) 2026 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

## Commons Clause Restriction

You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**

The same restriction covers the React Bits tools (Background Studio, Texture Lab, Shape Magic, Center Stage, Sound Lab and any tools added later) and the sounds in the sound library. **You may not sell, sublicense, or redistribute the tools or the sounds themselves, or offer the tools or a substantially similar copy of them as a hosted service-whether alone, in a bundle, or as a ported version.**

What you make with the tools is yours to use. You can use exported code, images, videos, and audio files in any personal or commercial application, website, or product, including paid ones. **You may not sell or redistribute the exports on their own, either individually or as the product itself, such as a sound, texture, background, or template pack.**

## No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

Opus Motion Library

MIT License

Copyright (c) 2026 Govindu Sasanka

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

three.js

The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
