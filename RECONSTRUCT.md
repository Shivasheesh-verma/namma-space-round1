# Reconstruct

One view is a colour photo, a depth image, the lens numbers, and a 4×4 pose. `test/sample/` holds eight frames in that shape. The full capture is the MuSHRoom classroom long capture, 797 frames.

The train used 550 of the sharpest frames, dropped frames with people, and seeded the points from the LiDAR at 4 cm. Colour ran for 30,000 steps. Depth weight was 0.05, so the room stays in metres. The config is `pipeline/mushroom_classroom_1m.json`.

From a checkout that has `experiments/m4-reconstruction/m4recon.py`:

```
python3 experiments/m4-reconstruction/m4recon.py run \
  --config experiments/m4-reconstruction/configs/mushroom_classroom_1m.json
```

The finished file is `scene.ply` on the `round1` release. The viewer loads it. Walls and the door are `mushroom/collision.json`, measured from the same depth. They are not part of the splat.
