#!/usr/bin/env python3
"""
Gerador de ícones do DiáriaJá — PWA + Android adaptive.

Uso:
  python3 scripts/generate-icons.py

Lê: assets/icon-source-brand.png (logo do app, idealmente 1024x1024 quadrado)
Gera:
  - public/icon-192.png + icon-512.png (PWA)
  - android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png (15 PNGs)

Requer: Pillow (pip install Pillow)

Histórico:
  - generate-icons.mjs (legado): gerava "DJ" laranja placeholder
  - v1 (2026-05-28): logo de marca com texto "DiáriaJá" → recortava só o círculo
  - v2 (2026-05-28): nova arte do raio amarelo em fundo laranja (1024x1024 nativo)
"""
from PIL import Image
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'icon-source-brand.png')
PUBLIC = os.path.join(ROOT, 'public')
ANDROID = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

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
    w, h = src.size

    # Garante quadrado. Se já for quadrado (caso da arte atual 1024x1024),
    # pass-through. Se não for, pad com transparência pra virar quadrado.
    if w != h:
        side = max(w, h)
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.paste(src, ((side - w) // 2, (side - h) // 2))
        src = sq

    master = src.resize((1024, 1024), Image.LANCZOS)

    # PWA
    master.resize((512, 512), Image.LANCZOS).save(f'{PUBLIC}/icon-512.png', optimize=True)
    master.resize((192, 192), Image.LANCZOS).save(f'{PUBLIC}/icon-192.png', optimize=True)
    print("PWA: icon-192.png + icon-512.png")

    # Android adaptive
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

    print("\nOK. Pra refletir no APK Android instalado:")
    print("  1. npm run build && npx cap sync android")
    print("  2. Rebuild + reinstall no dispositivo via Android Studio")
    print("Pra PWA: deploy normal (Vercel) — service worker pega no próximo carregamento.")

if __name__ == '__main__':
    main()
