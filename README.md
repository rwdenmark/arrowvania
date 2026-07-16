# Arrowvania

A small metroidvania prototype starring a ranger. Plain browser canvas, no build step, no dependencies.

## Run

    java Application.java

Opens http://localhost:8080 in your browser. Any static file server works too, everything is client side.

## Controls

A/D move, Space jump, S to fast-fall, left click aims and shoots, Esc pauses. Abilities are found in the world.

## Assets

The archer is rebuilt from the Spriter rig in the craftpix 2D Fantasy Archer pack by `assets/build_sheet.py`. The knight comes from the craftpix 2D Fantasy Knight pack via `assets/build_knight.py`. Tree and terrain accents come from `assets/build_tree_tiles.py`. All of these regenerate `assets.js`, which embeds everything the game loads. The cursor comes from a Vecteezy game cursor set.

## Sound

Sound effects are baked into `assets.js` by `assets/build_sfx.py`, most synthesized from scratch. The footsteps and the wood impact are trimmed from free sample packs, and the bow release is reused from my Recurve project. The charge hum, power-shot boom, bomb blast, and speed-boost shimmer are generated live with WebAudio. The menu button click (`card_select.mp3`) is reused from Recurve, and the menu music (`menu.mp3`) is a Pixabay track. Check the art, music, and sample licenses before distributing.
