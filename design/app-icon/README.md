# Crow HR app icon

The Crow Tech crow standing on a kuning "HR" card, on warm ivory. It follows Crow Tech's other app
icons (a black crow on ivory with one bold, flat object), and uses Crow HR's own tokens: ink
`#0A0A0A`, kuning-200 `#FED56C`, and the signature ink border with a hard offset shadow.

![Crow HR icon](crow-hr-icon-1024.png)

## Sources

- **Crow:** Crow Tech's own logo (`crow-tech-landing/public/crow_tech_logo.png`). The crow was
  cropped from the logo, upscaled 10x (Lanczos), thresholded and traced with potrace 1.16
  (`-a 1.2 -O 0.4`) into `crow-tech-crow.svg`. Its shape is unchanged.
- **"HR":** Azeret Mono Bold (SIL Open Font License 1.1, from `@fontsource/azeret-mono`), converted
  to outlines. No font ships in the apps.
- No generated or third-party artwork.

## Outputs

`make-app-icon.py` writes all of them from one layout. Edit the script, never the outputs.

| File | Use |
| --- | --- |
| `design/app-icon/crow-hr-icon.svg`, `crow-hr-icon-1024.png` | Master artwork |
| `apps/ios/CrowHR/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | iOS app icon (opaque RGB; iOS rounds the corners) |
| `apps/android/app/src/main/res/drawable/ic_launcher_foreground.xml` | Android adaptive icon, colour layer, scaled to the 66 dp safe zone |
| `apps/android/app/src/main/res/drawable/ic_launcher_monochrome.xml` | Android themed icon (Android 13+) |
| `apps/android/store/icon-512.png` | Google Play listing icon (opaque RGB) |

The adaptive icon's background is `@color/launcher_background` (`#FBF6EA`) in
`apps/android/app/src/main/res/values/colors.xml`.

## Regenerate

```sh
bun install                              # provides Playwright and the font
python3 design/app-icon/make-app-icon.py # needs fontTools and Pillow
```

PNG rendering uses Chromium through the repo's Playwright (`render.cjs`).
