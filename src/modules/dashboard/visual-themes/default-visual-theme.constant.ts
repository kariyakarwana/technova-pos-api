/**
 * Canonical default visual theme tokens for backend visual themes.
 * Uses exact values defined in global.css.
 */
export const DEFAULT_VISUAL_THEME_TOKENS = {
  mode: 'light',
  primaryColor: '#0E9384',
  secondaryColor: '#092C4C',
  backgroundColor: '#F8FAFC',
  cardBackground: '#FFFFFF',
  surfaceColor: '#F1F5F9',
  textColor: '#1D2939',
  borderRadius: '16px',
  fontFamily: 'Inter, sans-serif',
  
  customVariables: {
    'brand-stroke': '#E4E7EC',
    'brand-green-transparent': '#EEFFFD',
    'brand-orange': '#E26D1E',
    'brand-blue-action': '#1E6DE2',
  },
};

export const DEFAULT_VISUAL_THEME_IS_DEFAULT = true;

export const DEFAULT_VISUAL_THEME_DEFINITION = {
  name: 'Default',
  isDefault: true,
  tokens: DEFAULT_VISUAL_THEME_TOKENS,
};

