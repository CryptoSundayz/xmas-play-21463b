# Audio credits — Santa's Block Delivery

All music and sound effects are **synthesised at runtime in code** (`src/audio.js`, WebAudio).
No audio files are shipped, so there are no third-party recordings to license.

## Music (original arrangements of public-domain melodies)
| Use | Melody | Status |
|---|---|---|
| Title screen (music-box) | *Deck the Halls* — traditional Welsh (Nos Galan), English words T. Oliphant 1862 | Public domain |
| Gameplay loop (bells, bass, comp, sleigh bells) | *Jingle Bells* — James Lord Pierpont, 1857 | Public domain |
| BOOSTED layer | Original arpeggio over the gameplay chords | Original (this project) |
| Ending jingle | *We Wish You a Merry Christmas* — traditional English (West Country) | Public domain |
| Level-complete jingle | *Jingle Bells* opening phrase | Public domain |

Arrangements, voicings and synth patches: original code for this project.

## Sound effects (all synthesised)
Footsteps (snow crunch / cobble tap), sleigh bells, pickup (rise + chime + whoosh), delivery chime,
jump whoosh, wind bed (follows the snowstorm), fireworks (whistle, boom, crackle), timer tick, fail motif.

## Controls
`M` or the 🔊 HUD button toggles mute; music / SFX sliders in the pause menu (saved in localStorage).
Default volumes: `CONFIG.audio` in `src/config.js`. The audio context starts on the first tap/click/key.

## Other third-party assets (non-audio), for completeness
- Font: IM Fell English SC — Igino Marini, SIL Open Font License 1.1 (`assets/fonts/OFL-IMFell.txt`)
- three-mesh-bvh 0.9.1 — MIT (`vendor/three-mesh-bvh/LICENSE`)
