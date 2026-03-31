import { config } from "../package.json";
import { createZToolkit } from "./utils/ztoolkit";
import hooks from "./hooks";
import api from "./api";

export type ContextMode = "none" | "currentPage" | "selectedText" | "fullPdf";
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ServiceProvider = {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  model: string;
};

class Addon {
  public data: {
    config: typeof config;
    alive: boolean;
    env: "development" | "production";
    ztoolkit: ReturnType<typeof createZToolkit>;
    locale: {
      current?: any;
    };
    prefs: {
      window: Window | null;
    };
    popup: {
      currentPopup: HTMLDivElement | null;
      selectedText: string;
      currentReader: _ZoteroTypes.ReaderInstance | null;
    };
    panel: {
      activePanels: Record<string, () => void>;
      standaloneWindow: Window | null;
    };
    chat: {
      sessions: Record<number, ChatMessage[]>;
      prefillInput: string;
      contextMode: ContextMode;
    };
  };
  public hooks: typeof hooks;
  public api: typeof api;

  constructor() {
    this.data = {
      config,
      alive: true,
      env: __env__,
      ztoolkit: createZToolkit(),
      locale: {},
      prefs: { window: null },
      popup: { currentPopup: null, selectedText: "", currentReader: null },
      panel: { activePanels: {}, standaloneWindow: null },
      chat: {
        sessions: {},
        prefillInput: "",
        contextMode: "currentPage",
      },
    };
    this.hooks = hooks;
    this.api = api;
  }
}

export default Addon;
