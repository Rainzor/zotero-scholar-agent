import { getString } from "./locale";

export { isWindowAlive, localeWindow };

/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
function isWindowAlive(win?: Window) {
  return win && !Components.utils.isDeadWrapper(win) && !win.closed;
}

/**
 * Locale the elements in window with the locale-target attribute.
 * Useful when the window is created dynamically.
 * @example
 * In HTML:
 * ```html
 * <div locale-target="innerHTML,title" title="elem.title">elem.text</div>
 * ```
 * In `addon/chrome/locale/en-US/addon.properties`:
 * ```properties
 * elem.text=Hello World
 * elem.title=Locale example
 * ```
 * In `addon/chrome/locale/zh-CN/addon.properties`:
 * ```properties
 * elem.text=你好世界
 * elem.title=多语言样例
 * ```
 * After locale:
 *
 * if locale is "en-US"
 * ```html
 * <div locale-target="innerHTML,title" title="Locale example">Hello World</div>
 * ```
 * else if locale is "zh-CN"
 * ```html
 * <div locale-target="innerHTML,title" title="多语言样例">你好世界</div>
 * ```
 * @param win
 */
function localeWindow(win: Window) {
  Array.from(win.document.querySelectorAll("*[locale-target]")).forEach(
    (node) => {
      const elem = node as HTMLElement;
      const errorInfo = "Locale Error";
      const locales = elem.getAttribute("locale-target")?.split(",");
      locales?.forEach((key) => {
        const normalizedKey = key.trim();
        const isProp = normalizedKey in elem;
        try {
          const source = isProp
            ? String((elem as any)[normalizedKey] || "")
            : String(elem.getAttribute(normalizedKey) || "");
          const localeString = getString(source.trim());
          isProp
            ? ((elem as any)[normalizedKey] = localeString)
            : elem.setAttribute(normalizedKey, localeString);
        } catch (error) {
          isProp
            ? ((elem as any)[normalizedKey] = errorInfo)
            : elem.setAttribute(normalizedKey, errorInfo);
        }
      });
    },
  );
}
