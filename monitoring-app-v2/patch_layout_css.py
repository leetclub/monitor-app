from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> None:
    p = ROOT / "src/components/Layout.module.css"
    t = p.read_text(encoding="utf-8")
    old = """.logoMark {
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  background: linear-gradient(135deg, #0ea5e9, #6366f1);
}

"""
    if old not in t:
        print("skip")
        return
    p.write_text(t.replace(old, "", 1), encoding="utf-8")
    print("ok")


if __name__ == "__main__":
    main()
