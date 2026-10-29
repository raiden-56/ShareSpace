import { alpha, createTheme, type PaletteMode, type Theme } from '@mui/material/styles';

/** Brand palette (spec). */
export const brand = {
  green: '#386641',
  deepGreen: '#274C35',
  sage: '#E4EBDD',
  cream: '#F8F6F0',
  white: '#FFFFFF',
  charcoal: '#292D29',
  grey: '#777970',
  border: '#E7E4DB',
  orange: '#D58B42',
  terracotta: '#C96F52',
  success: '#4C8157',
  error: '#B94B45',
} as const;

/**
 * Text-safe variants. The spec grey (#777970) and terracotta fall below WCAG AA 4.5:1 as small
 * text on cream, so text uses slightly deeper tones of the same hues. Icons and borders keep
 * the spec values (they meet the 3:1 non-text requirement).
 */
const textTones = {
  light: { secondary: '#6E7067', positive: '#386641', negative: '#A4523A', attention: '#94591C' },
  dark: { secondary: '#A9AB9F', positive: '#8CC496', negative: '#E59A80', attention: '#E4AE6F' },
};

/**
 * Categorical chart palette: six slots validated with the dataviz palette checker
 * (lightness band, chroma floor, adjacent CVD ΔE ≥ 8, normal-vision ΔE ≥ 15, 3:1 contrast)
 * in both modes. Series beyond six fold into a neutral "Other" slot.
 */
export const chartPalette = {
  light: ['#2F8540', '#3E73C9', '#E0761C', '#8754C2', '#A88A00', '#C94A86'],
  dark: ['#4C9A5A', '#5E8FDE', '#D9732B', '#9C76D8', '#B08F12', '#D86A9E'],
  other: { light: '#9A9C92', dark: '#6F7268' },
} as const;

declare module '@mui/material/styles' {
  interface Palette {
    money: { positive: string; negative: string; neutral: string; attention: string };
    brand: typeof brand;
    chart: readonly string[];
    chartOther: string;
    surface: { subtle: string; sage: string; raised: string };
  }
  interface PaletteOptions {
    money?: Palette['money'];
    brand?: typeof brand;
    chart?: readonly string[];
    chartOther?: string;
    surface?: Palette['surface'];
  }
  interface TypographyVariants {
    money: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    money?: React.CSSProperties;
  }
}
declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    money: true;
  }
}

const fontFamily = '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

export function buildTheme(mode: PaletteMode, reducedMotion: boolean): Theme {
  const dark = mode === 'dark';
  const tones = dark ? textTones.dark : textTones.light;
  const bg = dark ? '#161A16' : brand.cream;
  const paper = dark ? '#1F241F' : brand.white;
  const divider = dark ? '#343A33' : brand.border;
  const textPrimary = dark ? '#ECEDE6' : brand.charcoal;
  const primaryMain = dark ? '#8CC496' : brand.green;

  const theme = createTheme({
    palette: {
      mode,
      primary: { main: primaryMain, dark: dark ? '#6FA97A' : brand.deepGreen, light: dark ? '#A9D4B0' : '#4E7F57', contrastText: dark ? '#10200F' : '#FFFFFF' },
      secondary: { main: brand.orange, contrastText: '#2A1A08' },
      warning: { main: brand.terracotta, dark: tones.negative, contrastText: '#FFFFFF' },
      error: { main: dark ? '#E07A73' : brand.error, contrastText: '#FFFFFF' },
      success: { main: dark ? '#7DB889' : brand.success, contrastText: '#FFFFFF' },
      info: { main: dark ? '#A9AB9F' : '#5E6158' },
      background: { default: bg, paper },
      text: { primary: textPrimary, secondary: tones.secondary, disabled: dark ? '#6F7268' : '#A5A79D' },
      divider,
      money: { positive: tones.positive, negative: tones.negative, neutral: tones.secondary, attention: tones.attention },
      brand,
      chart: dark ? chartPalette.dark : chartPalette.light,
      chartOther: dark ? chartPalette.other.dark : chartPalette.other.light,
      surface: {
        subtle: dark ? '#1B201B' : '#FBFAF6',
        sage: dark ? alpha('#8CC496', 0.12) : brand.sage,
        raised: dark ? '#262C26' : brand.white,
      },
      action: { hover: dark ? alpha('#ECEDE6', 0.06) : alpha(brand.charcoal, 0.04), selected: dark ? alpha('#8CC496', 0.16) : brand.sage },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily,
      h1: { fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.25 },
      h2: { fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.3 },
      h3: { fontSize: '1.125rem', fontWeight: 650, letterSpacing: '-0.01em', lineHeight: 1.35 },
      h4: { fontSize: '1rem', fontWeight: 650, lineHeight: 1.4 },
      h5: { fontSize: '0.9375rem', fontWeight: 650 },
      h6: { fontSize: '0.875rem', fontWeight: 650 },
      subtitle1: { fontSize: '0.9375rem', fontWeight: 600 },
      subtitle2: { fontSize: '0.8125rem', fontWeight: 600, color: tones.secondary },
      body1: { fontSize: '0.9375rem', lineHeight: 1.55 },
      body2: { fontSize: '0.875rem', lineHeight: 1.5 },
      caption: { fontSize: '0.75rem', lineHeight: 1.45, color: tones.secondary },
      overline: { fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', color: tones.secondary },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
      money: { fontFamily, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum" 1', fontWeight: 650, letterSpacing: '-0.01em' },
    },
    transitions: reducedMotion ? { create: () => 'none' } : undefined,
  });

  const focusRing = { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 };

  theme.components = {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: bg, WebkitFontSmoothing: 'antialiased' },
        '::selection': { background: alpha(primaryMain, 0.25) },
        '.tabular': { fontVariantNumeric: 'tabular-nums' },
        '*:focus-visible': focusRing,
        ...(reducedMotion ? { '*, *::before, *::after': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' } } : {}),
      },
    },
    MuiButtonBase: { defaultProps: { disableRipple: reducedMotion } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 10, paddingInline: 16, minHeight: 40, '&.Mui-focusVisible': focusRing },
        sizeSmall: { minHeight: 32, paddingInline: 12 },
        sizeLarge: { minHeight: 48 },
        outlined: { borderColor: divider },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 10, '&.Mui-focusVisible': focusRing } } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' }, outlined: { borderColor: divider } },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 14, borderColor: divider } },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 16, backgroundImage: 'none', border: dark ? `1px solid ${divider}` : 'none' },
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: '1.125rem', fontWeight: 700, paddingBottom: 8 } } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 10, backgroundColor: paper, '& .MuiOutlinedInput-notchedOutline': { borderColor: divider } },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontWeight: 500 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 8, fontWeight: 600 } } },
    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: { tooltip: { backgroundColor: dark ? '#ECEDE6' : brand.charcoal, color: dark ? brand.charcoal : '#fff', fontSize: '0.75rem', borderRadius: 8 }, arrow: { color: dark ? '#ECEDE6' : brand.charcoal } },
    },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minHeight: 44 } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 44 }, indicator: { height: 3, borderRadius: 3 } } },
    MuiListItemButton: { styleOverrides: { root: { borderRadius: 10, '&.Mui-selected': { backgroundColor: theme.palette.surface.sage } } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: divider }, head: { fontWeight: 650, color: tones.secondary, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' } } },
    MuiSkeleton: {
      defaultProps: { animation: reducedMotion ? false : 'wave' },
      styleOverrides: {
        root: {
          backgroundColor: dark ? alpha('#ECEDE6', 0.07) : '#ECE8DE',
          '&::after': { background: `linear-gradient(90deg, transparent, ${dark ? alpha('#ECEDE6', 0.05) : alpha('#FFFFFF', 0.55)}, transparent)`, animationDuration: '2.2s' },
        },
        rounded: { borderRadius: 10 },
      },
    },
    MuiAlert: { styleOverrides: { root: { borderRadius: 12, alignItems: 'center' } } },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 6, height: 8, backgroundColor: dark ? alpha('#ECEDE6', 0.08) : '#EDE9DF' }, bar: { borderRadius: 6 } } },
    MuiAvatar: { styleOverrides: { root: { fontWeight: 700, fontSize: '0.8125rem' } } },
    MuiMenu: { styleOverrides: { paper: { borderRadius: 12, border: `1px solid ${divider}` } } },
    MuiPopover: { styleOverrides: { paper: { borderRadius: 12 } } },
    MuiSnackbarContent: { styleOverrides: { root: { borderRadius: 12 } } },
  };
  return theme;
}
