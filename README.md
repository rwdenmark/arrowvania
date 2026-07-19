# Arrowvania

A small metroidvania prototype starring a ranger. Plain browser canvas, no build step, no dependencies.

## Run

    java Application.java

Opens http://localhost:8080 in your browser. Any static file server works too, everything is client side.

## Tests

    npm test

Runs the logic suite in `test/` on Node's built-in runner (Node 18+). Use the scoped command so stray IDE build copies under `out/` are not picked up.

## Layout

`src/` holds the game code: `game.js` is the main loop, player, camera, and world rendering, `logic.js` the pure collision/movement/save-code library the tests cover, `path.js` the enemy route planning, `enemies.js` the roster, AI, and enemy drawing, `levels.js` the map layouts, `bg.js` the backdrop painters, `ui.js` the menus and overlay screens, and `audio.js` the sound effects, synth, and music. `assets/js/` holds the baked asset packs (`assets.js` plus one `assets_*.js` per enemy family), `assets/audio/` the menu music and click, and `assets/` the Python build scripts that regenerate the packs.

## Maps

sandbox1 is the sunny prototype level. sandbox2 is the foggy-graveyard night theme with animated rain and its own tiles, on the same layout for now. `assets/build_night_tiles.py` regenerates the night tiles from the day set.

## Saving

Save stations in the world store your progress in the browser and heal you. Each save also shows a short code, and Enter Code on the menu rebuilds the save from the code alone, so progress survives cleared browser data.

## Controls

A/D move, Space jump, S to crouch, Shift to dash, Q drops bombs, left click aims and shoots, 1 opens the enemy spawn menu, 2 toggles the enemy info overlay, Esc pauses. Crouching halves your height and slows the walk. The dash covers 5 tiles on a 5 second cooldown and holds altitude mid-air. In the air, S drops you faster. Abilities are found in the world.

## Enemies

Twenty-four enemy types share one chassis with knight-1 stats: knights 1-3, trolls 1-3, skeletons 1-3, necromancers 1-3, orcs 1-3, elves 1-3, warriors 1-3, and pirates 1-3. Only knight 1 has the lunge. Necromancers fight from range with a bolt and summon their matching skeleton (one owed every 8s, two alive per caster). Elf 1, elf 3, warrior 3, and pirate 2 are also ranged and fire a bolt of their own. The level starts empty, spawn enemies with the 1 menu. `assets/build_enemies.py` rebakes all the sheets from the seven craftpix zips into one asset file per family.

## Assets

The archer is rebuilt from the Spriter rig in the craftpix 2D Fantasy Archer pack by `assets/build_sheet.py`. The knight comes from the craftpix 2D Fantasy Knight pack via `assets/build_knight.py`. Tree and terrain accents come from `assets/build_tree_tiles.py`. All of these regenerate `assets/js/assets.js`, which embeds everything the game loads. The cursor comes from a Vecteezy game cursor set.

## Sound

Sound effects are baked into `assets/js/assets.js` by `assets/build_sfx.py`, most synthesized from scratch. The footsteps and the wood impact are trimmed from free sample packs, and the bow release is reused from my Recurve project. The charge hum, power-shot boom, bomb blast, and speed-boost shimmer are generated live with WebAudio. The menu button click (`card_select.mp3`) is reused from Recurve, and the menu music (`menu.mp3`) is a Pixabay track. Check the art, music, and sample licenses before distributing.
