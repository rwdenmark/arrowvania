# Arrowvania

A small metroidvania prototype starring a ranger. Plain browser canvas, no build step, no dependencies.

## Run

    java Application.java

Opens http://localhost:8080 in your browser. Any static file server works too, everything is client side.

## Controls

A/D move, Shift sprint, Space jump, left click aims and shoots, Esc pauses. Abilities are found in the world.

## Assets

The archer is rebuilt from the Spriter rig in the craftpix 2D Fantasy Archer pack by `assets/build_sheet.py`. The knight comes from the craftpix 2D Fantasy Knight pack via `assets/build_knight.py`. Tree and terrain accents come from `assets/build_tree_tiles.py`. All of these regenerate `assets.js`, which embeds everything the game loads. The cursor comes from a Vecteezy game cursor set.

## Sound

Effects are baked into `assets.js` by `assets/build_sfx.py`. Most are synthesized from scratch. The footsteps and the wood impact are trimmed from free sample packs and the bow release is reused from my Recurve project. The source WAVs are not committed. The charge hum is generated live with WebAudio so it can hold for as long as the button is held. Check the art and sample licenses before distributing.
