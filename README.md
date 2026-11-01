# Namma Space, Round 1

A walkable classroom. The picture is a Gaussian splat trained from an iPhone LiDAR capture. The plan is the measured floor, 8.95 m by 7.43 m, with the furniture from the LiDAR, a 2 m scale bar, the closed door, and you.

- **Walk it now:** https://optical-apartment-gordon-increase.trycloudflare.com/
- **Same page on GitHub, after it republishes:** https://shivasheesh-verma.github.io/namma-space-round1/
- **Video, 3 min 59 s:** https://github.com/Shivasheesh-verma/namma-space-round1/blob/main/docs/Demonstration.mp4

Click the picture, then WASD. The mouse looks. Shift is faster. R returns to the start. Walls and the closed door stop you. Furniture does not. The top left counts the download, then shows the frame rate.

## What is where

| Path | Contents |
| --- | --- |
| [index.html](index.html) | The viewer page |
| [assets/](assets) | The renderer. This is what the page loads |
| [mushroom/](mushroom) | Walls, door, furniture plan, start point, and the splat |
| [docs/](docs) | Technical abstract, proof of concept, and the video |
| [docs/Technical-Abstract.pdf](docs/Technical-Abstract.pdf) | Architecture, pipeline, capture procedure, and the check (2 pages) |
| [docs/Proof-of-Concept.pdf](docs/Proof-of-Concept.pdf) | The viewer link and the video link |
| [docs/Demonstration.mp4](docs/Demonstration.mp4) | The video, 3 min 59 s. Spoken with the Piper Lessac voice |
| [RECONSTRUCT.md](RECONSTRUCT.md) | How the model was trained |
| [pipeline/mushroom_classroom_1m.json](pipeline/mushroom_classroom_1m.json) | The train config |
| [test/sample/](test/sample) | Eight frames of the capture: photo, depth, pose |

## Run it on this machine

```
python3 -m http.server 8766
```

Open http://127.0.0.1:8766/

## The splat files

`mushroom/scene.ply` is 333,910 points, 83 MB, taken unchanged from the trained file so GitHub Pages can host it. The full trained file has 888,760 points and is 220 MB. It is `scene.ply` on the [round1 release](https://github.com/Shivasheesh-verma/namma-space-round1/releases/tag/round1).

## Credit

MuSHRoom classroom, iPhone 12 Pro Max, November 2023, CC BY 4.0. The photos and the depth belong to that release. Held-out check on 24 views: 22.9 dB PSNR, SSIM 0.739, depth error 7.0 cm.
