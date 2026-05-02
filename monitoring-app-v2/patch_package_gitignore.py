import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> None:
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    scripts = pkg.setdefault("scripts", {})
    scripts["generate:favicons"] = "python3 scripts/gen-fav.py"
    (ROOT / "package.json").write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")

    gi = ROOT / ".gitignore"
    extra = "\n# K8s secret env (never commit)\nk8s/.secret.env\n"
    t = gi.read_text(encoding="utf-8")
    if "k8s/.secret.env" not in t:
        gi.write_text(t.rstrip() + extra, encoding="utf-8")

    print("ok")


if __name__ == "__main__":
    main()
