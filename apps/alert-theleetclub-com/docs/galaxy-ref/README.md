# Galaxy visual reference

Frames extracted from the user’s galaxy-rotation video (ffmpeg) for HUD art direction.

- `frame-01.png` … `frame-04.png` — local only (gitignored); regenerate with:

```bash
ffmpeg -y -i "/path/to/galaxy.mp4" -vf "fps=1/3,scale=720:-1" -frames:v 4 frame-%02d.png
```

HUD implementation (`BUILD: 20261014-galaxy-zoom`) maps this look to:
- gold particle core + silver orbital arcs
- slow whole-galaxy spin at overview (Region/Brand)
- adaptive fan/cluster on drill-in via `analyzeFocusPlan`
