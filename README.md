# Arrowvania

A small metroidvania prototype starring a ranger. Plain browser canvas, no build step, no dependencies.

## Run

    java Application.java

Opens http://localhost:8080 in your browser. Any static file server works too, everything is client side.

## Controls

A/D move, Shift sprint, Space jump, left click aims and shoots, Esc pauses. Abilities are found in the world. The gray box in the underground room grants a double jump. The glowing box in the sky room grants the power shot, hold left click to charge it and release to fire.

## Assets

The archer is rebuilt from the Spriter rig in the craftpix 2D Fantasy Archer pack by `assets/build_sheet.py`. Tree and terrain accents come from `assets/build_tree_tiles.py`. Both scripts regenerate `assets.js`, which embeds every image the game loads. The cursor comes from a Vecteezy game cursor set. Check both licenses before distributing.
