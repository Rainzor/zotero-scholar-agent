export type SlashToken = {
  query: string;
  slashStart: number;
  caretEnd: number;
};

export type SlashCommandName = "init" | "summary" | "compact";

export type SlashCommand = {
  name: SlashCommandName;
  label: string;
  description: string;
  execute: (body: HTMLElement, itemId: number) => Promise<void>;
};

type CommandHandlers = Record<
  SlashCommandName,
  (body: HTMLElement, itemId: number) => Promise<void>
>;

export function parseSlashToken(input: string, caret: number): SlashToken | null {
  const safeInput = typeof input === "string" ? input : "";
  if (!safeInput) return null;

  const normalizedCaret = Math.max(0, Math.min(caret, safeInput.length));
  let slashIndex = safeInput.lastIndexOf("/", normalizedCaret - 1);
  while (slashIndex >= 0) {
    if (slashIndex === 0 || /\s/u.test(safeInput[slashIndex - 1] || "")) {
      let tokenEnd = safeInput.length;
      const match = safeInput.slice(slashIndex + 1).match(/\s/u);
      if (match?.index !== undefined) {
        tokenEnd = slashIndex + 1 + match.index;
      }
      if (normalizedCaret <= tokenEnd) {
        return {
          query: safeInput.slice(slashIndex + 1, Math.min(normalizedCaret, tokenEnd)),
          slashStart: slashIndex,
          caretEnd: normalizedCaret,
        };
      }
    }
    slashIndex = safeInput.lastIndexOf("/", slashIndex - 1);
  }
  return null;
}

export function consumeSlashToken(
  input: string,
  token: SlashToken,
): { value: string; caret: number } {
  const before = input.slice(0, token.slashStart);
  const after = input.slice(token.caretEnd);
  const value = `${before}${after}`;
  return {
    value,
    caret: token.slashStart,
  };
}

export function buildSlashCommands(handlers: CommandHandlers): SlashCommand[] {
  return [
    {
      name: "init",
      label: "/init",
      description: "Read full text and generate AGENTS.md overview",
      execute: handlers.init,
    },
    {
      name: "summary",
      label: "/summary",
      description: "Read full text and output a structured paper summary",
      execute: handlers.summary,
    },
    {
      name: "compact",
      label: "/compact",
      description: "Compact conversation memory to reduce context usage",
      execute: handlers.compact,
    },
  ];
}

export function filterSlashCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((cmd) => {
    return (
      cmd.name.toLowerCase().includes(q) ||
      cmd.label.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q)
    );
  });
}
