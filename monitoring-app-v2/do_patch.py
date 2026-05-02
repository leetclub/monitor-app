from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> None:
    layout = ROOT / "src/components/Layout.tsx"
    t = layout.read_text(encoding="utf-8")
    o = '<span className={styles.logoMark} aria-hidden />'
    n = """<img
            className={styles.logoImg}
            src="/leet.png"
            alt=""
            width={40}
            height={40}
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/leet.svg';
            }}
          />"""
    if o not in t:
        raise SystemExit("logoMark not found")
    layout.write_text(t.replace(o, n, 1), encoding="utf-8")
    print("layout patched")


if __name__ == "__main__":
    main()
