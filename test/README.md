# Sample

Eight frames from the MuSHRoom classroom long capture, so the input shape can be checked without the full 797-frame set.

`transformations.json` lists each photo, its depth PNG, the lens, and the 4×4 pose. Images are in `images/`. Depth is in `depth/`.

## Route check

```
node --test test/path.test.js
```

Builds the route grid from `mushroom/collision.json` and `mushroom/plan.json`, finds a route from the start to every place in `mushroom/pois.json`, and walks each one with the same body the viewer uses. A route passes only if the body is never stopped.
