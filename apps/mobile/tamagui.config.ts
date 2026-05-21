import { createTamagui } from 'tamagui';
import { config as baseConfig } from '@tamagui/config';

/**
 * Minimal polly theme.
 *
 * We start from Tamagui's default config (it supplies validated fonts, space,
 * size and radius tokens, shorthands and animations) and override only the
 * themes — a neutral gray surface palette plus a single indigo accent. Those
 * theme values resolve identically on native and web, which is the whole point
 * of running everything through Tamagui.
 */

const palette = {
  white: '#ffffff',
  gray50: '#fafafa',
  gray100: '#f4f4f5',
  gray200: '#e4e4e7',
  gray400: '#a1a1aa',
  gray600: '#52525b',
  gray800: '#27272a',
  gray900: '#18181b',
  gray950: '#09090b',
  indigo: '#4f46e5',
  indigoDark: '#4338ca',
  indigoLight: '#818cf8',
  indigoLighter: '#a5b4fc',
} as const;

const lightTheme = {
  background: palette.white,
  backgroundHover: palette.gray100,
  backgroundPress: palette.gray200,
  backgroundFocus: palette.gray100,
  color: palette.gray900,
  colorHover: palette.gray800,
  colorPress: palette.gray950,
  borderColor: palette.gray200,
  placeholderColor: palette.gray400,
  accent: palette.indigo,
  accentHover: palette.indigoDark,
};

const darkTheme = {
  background: palette.gray950,
  backgroundHover: palette.gray900,
  backgroundPress: palette.gray800,
  backgroundFocus: palette.gray900,
  color: palette.gray50,
  colorHover: palette.gray200,
  colorPress: palette.white,
  borderColor: palette.gray800,
  placeholderColor: palette.gray600,
  accent: palette.indigoLight,
  accentHover: palette.indigoLighter,
};

export const config = createTamagui({
  ...baseConfig,
  themes: {
    light: lightTheme,
    dark: darkTheme,
  },
});

export type AppConfig = typeof config;

// Make the custom theme keys (e.g. `$accent`) type-safe everywhere `tamagui`
// is imported.
declare module 'tamagui' {
  // Empty body is intentional — this is Tamagui's standard way to register a
  // custom config with the type system.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
