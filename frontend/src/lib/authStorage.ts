const REMEMBER_KEY = "evalio:remember-me";

export function getRememberPreference(): boolean {
  return window.localStorage.getItem(REMEMBER_KEY) !== "false";
}

export function setRememberPreference(remember: boolean): void {
  window.localStorage.setItem(REMEMBER_KEY, String(remember));
}

export const authStorage = {
  getItem(key: string): string | null {
    const store = getRememberPreference()
      ? window.localStorage
      : window.sessionStorage;
    return store.getItem(key);
  },
  setItem(key: string, value: string): void {
    const remember = getRememberPreference();
    const store = remember ? window.localStorage : window.sessionStorage;
    const other = remember ? window.sessionStorage : window.localStorage;
    store.setItem(key, value);
    other.removeItem(key);
  },
  removeItem(key: string): void {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};
