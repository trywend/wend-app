import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";

import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { go } from "@codemirror/lang-go";
import { rust } from "@codemirror/lang-rust";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";
import { shell } from "@codemirror/legacy-modes/mode/shell";

const ready = (support: LanguageSupport) => Promise.resolve(support);

const shellSupport = new LanguageSupport(StreamLanguage.define(shell));

export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: "javascript",
    alias: ["js", "node"],
    extensions: ["js", "mjs", "cjs"],
    load: () => ready(javascript()),
  }),
  LanguageDescription.of({
    name: "jsx",
    load: () => ready(javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: "typescript",
    alias: ["ts"],
    extensions: ["ts", "mts", "cts"],
    load: () => ready(javascript({ typescript: true })),
  }),
  LanguageDescription.of({
    name: "tsx",
    load: () => ready(javascript({ jsx: true, typescript: true })),
  }),
  LanguageDescription.of({
    name: "python",
    alias: ["py"],
    extensions: ["py"],
    load: () => ready(python()),
  }),
  LanguageDescription.of({
    name: "json",
    extensions: ["json"],
    load: () => ready(json()),
  }),
  LanguageDescription.of({
    name: "css",
    extensions: ["css"],
    load: () => ready(css()),
  }),
  LanguageDescription.of({
    name: "html",
    alias: ["htm"],
    extensions: ["html", "htm"],
    load: () => ready(html()),
  }),
  LanguageDescription.of({
    name: "shell",
    alias: ["bash", "sh", "zsh", "shellscript"],
    extensions: ["sh", "bash", "zsh"],
    load: () => ready(shellSupport),
  }),
  LanguageDescription.of({
    name: "go",
    extensions: ["go"],
    load: () => ready(go()),
  }),
  LanguageDescription.of({
    name: "rust",
    alias: ["rs"],
    extensions: ["rs"],
    load: () => ready(rust()),
  }),
  LanguageDescription.of({
    name: "java",
    extensions: ["java"],
    load: () => ready(java()),
  }),
  LanguageDescription.of({
    name: "cpp",
    alias: ["c", "c++", "cc", "h", "hpp"],
    extensions: ["c", "cc", "cpp", "h", "hpp"],
    load: () => ready(cpp()),
  }),
  LanguageDescription.of({
    name: "sql",
    extensions: ["sql"],
    load: () => ready(sql()),
  }),
  LanguageDescription.of({
    name: "yaml",
    alias: ["yml"],
    extensions: ["yaml", "yml"],
    load: () => ready(yaml()),
  }),
  LanguageDescription.of({
    name: "markdown",
    alias: ["md"],
    extensions: ["md", "markdown"],
    load: () => ready(markdown()),
  }),
];
