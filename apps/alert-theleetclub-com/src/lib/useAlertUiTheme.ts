import { useEffect, useState } from 'react';
import {
  readAlertUiTheme,
  subscribeAlertUiTheme,
  type AlertUiThemeId,
} from '@/lib/uiTheme';

/** Live Classic / Pro theme for layout branching. */
export function useAlertUiTheme(): AlertUiThemeId {
  const [theme, setTheme] = useState<AlertUiThemeId>(() => readAlertUiTheme());
  useEffect(() => subscribeAlertUiTheme(() => setTheme(readAlertUiTheme())), []);
  return theme;
}
