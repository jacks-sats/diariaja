#!/usr/bin/env python3
"""
Gerador de ícones do DiáriaJá — PWA + Android adaptive.

Uso:
  python3 scripts/generate-icons.py

Lê: assets/icon-source-brand.png (logo com texto)
Gera:
  - public/icon-192.png + icon-512.png (PWA)
  - android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png (15 PNGs)

Requer: Pillow (pip install Pillow)

Histórico:
  - generate-icons.mjs (legado): gerava ícone "DJ" laranja genérico via Node puro
  - generate-icons.py (atual):   usa logo de marca real (círculo laranja + raio)
"""
from PIL import Image
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'icon-source-brand.png')
PUBLIC = os.path.join(ROOT, 'public')
ANDROID = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

# Bbox do círculo na imagem fonte (logo: círculo na metade superior + texto embaixo)
# Determinado por detecção de pixels laranjas + ajuste manual pra incluir sombra.
# Se trocar a imagem fonte, RECALCULE essa região.
CROP = (135, 30, 425, 320)  # (left, top, right, bottom) — quadrado 290x290

ANDROID_SIZES = {
    'mdpi':    {'legacy': 48,  'foreground': 108},
    'hdpi':    {'legacy': 72,  'foreground': 162},
    'xhdpi':   {'legacy': 96,  'foreground': 216},
    'xxhdpi':  {'legacy': 144, 'foreground': 324},
    'xxxhdpi': {'legacy': 192, 'foreground': 432},
}

def main():
    if not os.path.exists(SRC):
        sys.exit(f"Erro: fonte não encontrada em {SRC}")

    src = Image.open(SRC).convert('RGBA')
    cropped = src.crop(CROP)
    w, h = cropped.size
    side = max(w, h)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(cropped, ((side - w) // 2, (side - h) // 2))
    master = sq.resize((1024, 1024), Image.LANCZOS)

    # ── PWA ────────────────────────────────────────────────────────────────
    master.resize((512, 512), Image.LANCZOS).save(f'{PUBLIC}/icon-512.png', optimize=True)
    master.resize((192, 192), Image.LANCZOS).save(f'{PUBLIC}/icon-192.png', optimize=True)
    print("PWA: icon-192.png + icon-512.png")

    # ── Android Adaptive ───────────────────────────────────────────────────
    # Legacy (Android 7.1 e abaixo): ic_launcher + ic_launcher_round
    # Adaptive (Android 8+): ic_launcher_foreground — design no centro 66% (safe zone)
    for density, sizes in ANDROID_SIZES.items():
        d = os.path.join(ANDROID, f'mipmap-{density}')
        legacy = master.resize((sizes['legacy'], sizes['legacy']), Image.LANCZOS)
        legacy.save(f'{d}/ic_launcher.png', optimize=True)
        legacy.save(f'{d}/ic_launcher_round.png', optimize=True)

        fg_size = sizes['foreground']
        icon_size = int(fg_size * 0.66)
        icon = master.resize((icon_size, icon_size), Image.LANCZOS)
        fg_canvas = Image.new('RGBA', (fg_size, fg_size), (0, 0, 0, 0))
        off = (fg_size - icon_size) // 2
        fg_canvas.paste(icon, (off, off), icon)
        fg_canvas.save(f'{d}/ic_launcher_foreground.png', optimize=True)
        print(f"Android {density}: legacy={sizes['legacy']}px, foreground={fg_size}px")

    print("\nOK. Lembrete: pra refletir no APK Android instalado, é necessário:")
    print("  1. npm run build && npx cap sync android")
    print("  2. Rebuild + reinstall no dispositivo via Android Studio")
    print("Pra PWA, basta o deploy normal (Vercel) — service worker pega no próximo carregamento.")

if __name__ == '__main__':
    main()
