import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const ember = "#C24A2E";
const ink = "#1A1714";
const muted = "#9A8F7E";
const string = "#5C7A52";
const number = "#9A6A2E";
const type = "#7A5A8C";
const func = "#3E6A8C";
const variable = "#3A332C";

export const wendHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: ember, fontWeight: "600" },
  { tag: [t.moduleKeyword, t.definitionKeyword], color: ember, fontWeight: "600" },
  { tag: [t.string, t.special(t.string), t.regexp], color: string },
  { tag: [t.number, t.bool, t.atom, t.special(t.brace)], color: number },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: muted, fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace], color: type },
  { tag: [t.definition(t.function(t.variableName)), t.function(t.variableName), t.function(t.propertyName)], color: func },
  { tag: [t.propertyName, t.attributeName], color: variable },
  { tag: [t.variableName, t.labelName], color: variable },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.brace, t.paren], color: ink },
  { tag: [t.tagName], color: ember },
  { tag: [t.angleBracket, t.derefOperator], color: muted },
  { tag: [t.meta, t.documentMeta], color: muted },
  { tag: [t.escape, t.special(t.variableName)], color: number },
  { tag: t.invalid, color: "#D14A3C" },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: number },
  { tag: t.self, color: ember },
]);
