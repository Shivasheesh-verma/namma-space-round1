# Reconstruct

Shivasheesh Verma, Class 11, Gulmohar High School. Sarvagya Kaushik, Class 11, Gulmohar High School. Vidhi Arora, Class 11, Springdale Senior School.

One view is a colour photo, a depth image, the lens numbers, and a 4×4 pose. `test/sample/` holds eight frames in that shape. The full capture is the MuSHRoom classroom long capture, 797 frames.

The 550 sharpest frames were kept, with frames showing people dropped. The 24 of those whose frame number is a multiple of 20 were held out for the check and never trained on. The other 526 trained. The points were seeded from the LiDAR depth of the training frames at a 4 cm voxel. Colour ran for 30,000 steps. Depth weight was 0.05, so the room stays in metres. The config is `pipeline/mushroom_classroom_1m.json`.

The train ran in the Namma Space working tree, which is not part of this repository. There, `pipeline/mushroom_classroom_1m.json` lives at `experiments/m4-reconstruction/configs/`, and the command was:

```
python3 experiments/m4-reconstruction/m4recon.py run \
  --config experiments/m4-reconstruction/configs/mushroom_classroom_1m.json
```

## Result

- The trained model held 999,454 Gaussians. The export kept 888,760 and dropped 110,694. That export is the picture on the viewer link, about 220 MB.
- Held-out check, 24 views, raw poses: 22.9 dB PSNR, SSIM 0.739, depth error 7.0 cm mean, 2.7 cm median.

The walls and the door are `mushroom/collision.json`, measured from the same depth. They are not part of the splat.
