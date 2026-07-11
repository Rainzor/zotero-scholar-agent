import { config } from "../../../package.json";

export function prefId(key: string): string {
  return `${config.addonRef}-${key}`;
}
