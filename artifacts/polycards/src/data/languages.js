// Language catalog — each entry describes one learnable language.
// Only languages with available:true have a real deck file.
// Coming-soon languages show in the UI but are disabled.
export const LANGUAGES = [
  {
    id:         'french',
    label:      'French',
    nativeName: 'Français',
    flag:       '🇫🇷',
    flagCode:   'fr',
    ttsCode:    'fr-FR',
    available:  true,
  },
  {
    id:         'spanish',
    label:      'Spanish',
    nativeName: 'Español',
    flag:       '🇪🇸',
    flagCode:   'es',
    ttsCode:    'es-ES',
    available:  false,
  },
  {
    id:         'german',
    label:      'German',
    nativeName: 'Deutsch',
    flag:       '🇩🇪',
    flagCode:   'de',
    ttsCode:    'de-DE',
    available:  false,
  },
  {
    id:         'italian',
    label:      'Italian',
    nativeName: 'Italiano',
    flag:       '🇮🇹',
    flagCode:   'it',
    ttsCode:    'it-IT',
    available:  false,
  },
  {
    id:         'japanese',
    label:      'Japanese',
    nativeName: '日本語',
    flag:       '🇯🇵',
    flagCode:   'jp',
    ttsCode:    'ja-JP',
    available:  false,
  },
  {
    id:         'portuguese',
    label:      'Portuguese',
    nativeName: 'Português (BR)',
    flag:       '🇧🇷',
    flagCode:   'br',
    ttsCode:    'pt-BR',
    available:  false,
  },
];
