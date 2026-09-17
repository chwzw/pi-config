import {
  Editor,
  Key,
  Text,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
const OptionSchema = Type.Object({
  label: Type.String({
    description: 'Display label for the option. If you recommend an option, place it first and append "(Recommended)" to the label.'
  }),
  value: Type.Optional(
    Type.String({
      description: "Optional machine-readable value returned for the option. Defaults to the label."
    })
  ),
  description: Type.Optional(Type.String({ description: "Optional extra detail shown below the option." }))
});
const AskUserQuestionParams = Type.Object({
  question: Type.String({
    description: "The single question to ask the user. Ask exactly one question per tool call."
  }),
  details: Type.Optional(
    Type.String({
      description: "Optional extra context or instructions shown under the question."
    })
  ),
  options: Type.Optional(
    Type.Array(OptionSchema, {
      description: "Optional multiple-choice options. Omit or pass an empty array for free-form text input. Users will always be able to choose Other and type a custom answer when options are provided."
    })
  ),
  multiSelect: Type.Optional(
    Type.Boolean({
      description: "Set to true to allow multiple answers to be selected for a question."
    })
  )
});
function normalizeOptions(options) {
  return (options || []).map((option) => ({
    label: option.label.trim(),
    value: option.value?.trim() || option.label.trim(),
    description: option.description?.trim() || void 0
  })).filter((option) => option.label.length > 0);
}
function getOtherLabel(options) {
  return options.some((option) => option.label.toLowerCase() === "other") ? "Other (custom)" : "Other";
}
function createEditorTheme(theme) {
  return {
    borderColor: (s) => theme.fg("accent", s),
    selectList: {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t)
    }
  };
}
function addWrapped(lines, text, width, indent = "") {
  const contentWidth = Math.max(1, width - indent.length);
  for (const line of wrapTextWithAnsi(text, contentWidth)) {
    lines.push(truncateToWidth(`${indent}${line}`, width));
  }
}
function pushWrappedLabel(lines, prefix, text, width) {
  const prefixWidth = visibleWidth(prefix);
  if (prefixWidth >= width) {
    lines.push(truncateToWidth(prefix, width));
    return;
  }
  const contentWidth = Math.max(1, width - prefixWidth);
  const wrapped = wrapTextWithAnsi(text, contentWidth);
  const indent = " ".repeat(prefixWidth);
  for (let i = 0; i < wrapped.length; i++) {
    const lead = i === 0 ? prefix : indent;
    lines.push(truncateToWidth(`${lead}${wrapped[i]}`, width));
  }
}
function makeNoteEditor(tui, theme) {
  const editor = new Editor(tui, createEditorTheme(theme));
  editor.focused = false;
  editor.disableSubmit = true;
  return editor;
}
function formatAnswerForModel(answer) {
  switch (answer.type) {
    case "text":
      return answer.label;
    case "other":
      return `Other: ${answer.label}`;
    case "option":
      return `${answer.index}. ${answer.label}`;
  }
}
function answerSortRank(answer) {
  switch (answer.type) {
    case "option":
      return answer.index;
    case "other":
      return Number.MAX_SAFE_INTEGER - 1;
    case "text":
      return Number.MAX_SAFE_INTEGER;
  }
}
function sortAnswers(answers) {
  return [...answers].sort((a, b) => answerSortRank(a) - answerSortRank(b));
}
function buildStructuredResult(status, question, mode, answers, context, message, note) {
  return {
    status,
    question,
    context,
    mode,
    answers,
    note,
    message
  };
}
function cancelledResult(question, mode, context) {
  const message = "User cancelled the question";
  return {
    content: [{ type: "text", text: message }],
    details: buildStructuredResult("cancelled", question, mode, [], context, message)
  };
}
function unavailableResult(question, mode, message, context) {
  return {
    content: [{ type: "text", text: message }],
    details: buildStructuredResult("unavailable", question, mode, [], context, message)
  };
}
function buildResult(question, context, mode, answers, note) {
  let text;
  if (mode === "text") {
    const answer = answers[0];
    text = answer.label.trim().length > 0 ? `User answered: ${answer.label}` : "User submitted an empty response";
  } else if (mode === "single-select") {
    text = `User selected: ${formatAnswerForModel(answers[0])}`;
  } else {
    text = `User selected:
${answers.map((answer) => `- ${formatAnswerForModel(answer)}`).join("\n")}`;
  }
  if (note) text += `
User's note: ${note}`;
  return {
    content: [{ type: "text", text }],
    details: buildStructuredResult("answered", question, mode, answers, context, void 0, note)
  };
}
async function askSingleChoice(ctx, question, context, options) {
  const otherLabel = getOtherLabel(options);
  const allOptions = [
    ...options.map((option, index) => ({ ...option, id: `option:${index}`, index: index + 1 })),
    { id: "other", label: otherLabel, value: "__other__", isOther: true }
  ];
  return ctx.ui.custom(
    (tui, theme, _kb, done) => {
      let optionIndex = 0;
      let editMode = false;
      let noteMode = false;
      let cachedLines;
      let cachedWidth = -1;
      const editor = new Editor(tui, createEditorTheme(theme));
      const noteEditor = makeNoteEditor(tui, theme);
      editor.onSubmit = (value) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        done({ answer: { type: "other", label: trimmed, value: trimmed }, note: noteText() });
      };
      function refresh() {
        cachedLines = void 0;
        tui.requestRender();
      }
      function noteText() {
        const t = noteEditor.getText().trim();
        return t.length ? t : void 0;
      }
      function toOptions() {
        noteMode = false;
        noteEditor.focused = false;
        refresh();
      }
      function handleInput(data) {
        if (editMode) {
          if (matchesKey(data, Key.escape)) {
            editMode = false;
            editor.setText("");
            refresh();
            return;
          }
          editor.handleInput(data);
          refresh();
          return;
        }
        if (noteMode) {
          if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
            toOptions();
            return;
          }
          noteEditor.handleInput(data);
          tui.requestRender();
          return;
        }
        if (data === "n" || matchesKey(data, Key.tab)) {
          noteMode = true;
          noteEditor.focused = true;
          refresh();
          return;
        }
        if (matchesKey(data, Key.up) || data === "k") {
          optionIndex = Math.max(0, optionIndex - 1);
          refresh();
          return;
        }
        if (matchesKey(data, Key.down) || data === "j") {
          optionIndex = Math.min(allOptions.length - 1, optionIndex + 1);
          refresh();
          return;
        }
        if (matchesKey(data, Key.enter)) {
          const selected = allOptions[optionIndex];
          if (selected.isOther) {
            editMode = true;
            editor.setText("");
            refresh();
            return;
          }
          done({
            answer: {
              type: "option",
              label: selected.label,
              value: selected.value,
              index: selected.index
            },
            note: noteText()
          });
          return;
        }
        if (matchesKey(data, Key.escape)) {
          done(null);
        }
      }
      function render(width) {
        if (cachedLines && cachedWidth === width) return cachedLines;
        const lines = [];
        const add = (text) => lines.push(truncateToWidth(text, width));
        add(theme.fg("accent", "\u2500".repeat(width)));
        addWrapped(lines, theme.fg("text", ` ${question}`), width);
        if (context) {
          lines.push("");
          addWrapped(lines, theme.fg("muted", ` ${context}`), width);
        }
        lines.push("");
        for (let i = 0; i < allOptions.length; i++) {
          const option = allOptions[i];
          const selected = i === optionIndex;
          const prefix = selected ? theme.fg("accent", "> ") : "  ";
          const label = option.isOther ? option.label : `${option.index}. ${option.label}`;
          const styled = selected ? theme.fg("accent", label) : theme.fg("text", label);
          pushWrappedLabel(lines, prefix, styled, width);
          if (option.description) {
            addWrapped(lines, theme.fg("muted", option.description), width, "     ");
          }
        }
        if (editMode) {
          lines.push("");
          add(theme.fg("muted", " Write your custom answer:"));
          for (const line of editor.render(Math.max(1, width - 2))) {
            add(` ${line}`);
          }
          lines.push("");
          add(theme.fg("dim", " Enter to submit \u2022 Esc to go back"));
        } else {
          lines.push("");
          const noteLabel = noteMode ? theme.fg("accent", " Note (optional):") : theme.fg("muted", " Note (optional):");
          addWrapped(lines, noteLabel, width, " ");
          for (const line of noteEditor.render(width)) lines.push(line);
          lines.push("");
          if (noteMode) {
            add(theme.fg("dim", " Type note \u2022 Ctrl+J newline \u2022 Enter/Esc back"));
          } else {
            add(theme.fg("dim", " \u2191\u2193 navigate \u2022 Enter select \u2022 n note \u2022 Esc cancel"));
          }
        }
        add(theme.fg("accent", "\u2500".repeat(width)));
        if (!noteMode) {
          cachedLines = lines;
          cachedWidth = width;
        }
        return lines;
      }
      return {
        render,
        invalidate: () => {
          cachedLines = void 0;
          noteEditor.invalidate();
        },
        handleInput
      };
    }
  );
}
async function askMultiChoice(ctx, question, context, options) {
  const otherLabel = getOtherLabel(options);
  const choiceItems = options.map((option, index) => ({
    ...option,
    id: `option:${index}`,
    index: index + 1
  }));
  const submitItem = { id: "submit", label: "Submit", value: "__submit__", isSubmit: true };
  const allItems = [
    ...choiceItems,
    { id: "other", label: otherLabel, value: "__other__", isOther: true },
    submitItem
  ];
  return ctx.ui.custom(
    (tui, theme, _kb, done) => {
      let optionIndex = 0;
      let editMode = false;
      let noteMode = false;
      let cachedLines;
      let cachedWidth = -1;
      const selected = /* @__PURE__ */ new Map();
      const editor = new Editor(tui, createEditorTheme(theme));
      const noteEditor = makeNoteEditor(tui, theme);
      editor.onSubmit = (value) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        selected.set("other", { type: "other", label: trimmed, value: trimmed });
        editMode = false;
        refresh();
      };
      function refresh() {
        cachedLines = void 0;
        tui.requestRender();
      }
      function noteText() {
        const t = noteEditor.getText().trim();
        return t.length ? t : void 0;
      }
      function toOptions() {
        noteMode = false;
        noteEditor.focused = false;
        refresh();
      }
      function toggleOption(item) {
        if (selected.has(item.id)) {
          selected.delete(item.id);
        } else {
          selected.set(item.id, {
            type: "option",
            label: item.label,
            value: item.value,
            index: item.index
          });
        }
        refresh();
      }
      function handleInput(data) {
        if (editMode) {
          if (matchesKey(data, Key.escape)) {
            editMode = false;
            editor.setText(selected.get("other")?.label || "");
            refresh();
            return;
          }
          editor.handleInput(data);
          refresh();
          return;
        }
        if (noteMode) {
          if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
            toOptions();
            return;
          }
          noteEditor.handleInput(data);
          tui.requestRender();
          return;
        }
        if (data === "n" || matchesKey(data, Key.tab)) {
          noteMode = true;
          noteEditor.focused = true;
          refresh();
          return;
        }
        if (matchesKey(data, Key.up) || data === "k") {
          optionIndex = Math.max(0, optionIndex - 1);
          refresh();
          return;
        }
        if (matchesKey(data, Key.down) || data === "j") {
          optionIndex = Math.min(allItems.length - 1, optionIndex + 1);
          refresh();
          return;
        }
        const current = allItems[optionIndex];
        if (matchesKey(data, Key.space)) {
          if (current.isSubmit) return;
          if (current.isOther) {
            if (selected.has("other")) {
              selected.delete("other");
              refresh();
            } else {
              editMode = true;
              editor.setText("");
              refresh();
            }
            return;
          }
          toggleOption(current);
          return;
        }
        if (matchesKey(data, Key.enter)) {
          if (current.isSubmit) {
            if (selected.size > 0) {
              done({ answers: sortAnswers(Array.from(selected.values())), note: noteText() });
            }
            return;
          }
          if (current.isOther) {
            editMode = true;
            editor.setText(selected.get("other")?.label || "");
            refresh();
            return;
          }
          toggleOption(current);
          return;
        }
        if (matchesKey(data, Key.escape)) {
          done(null);
        }
      }
      function render(width) {
        if (cachedLines && cachedWidth === width) return cachedLines;
        const lines = [];
        const add = (text) => lines.push(truncateToWidth(text, width));
        add(theme.fg("accent", "\u2500".repeat(width)));
        addWrapped(lines, theme.fg("text", ` ${question}`), width);
        if (context) {
          lines.push("");
          addWrapped(lines, theme.fg("muted", ` ${context}`), width);
        }
        lines.push("");
        for (let i = 0; i < allItems.length; i++) {
          const item = allItems[i];
          const isFocused = i === optionIndex;
          const prefix = isFocused ? theme.fg("accent", "> ") : "  ";
          if (item.isSubmit) {
            const label2 = selected.size > 0 ? `\u2713 ${item.label} (${selected.size} selected)` : `\u25CB ${item.label}`;
            const styled2 = isFocused ? theme.fg("accent", label2) : theme.fg(selected.size > 0 ? "success" : "dim", label2);
            pushWrappedLabel(lines, prefix, styled2, width);
            continue;
          }
          if (item.isOther) {
            const other = selected.get("other");
            const marker2 = other ? "[x]" : "[ ]";
            const suffix = other ? ` \u2014 ${other.label}` : "";
            const styled2 = isFocused ? theme.fg("accent", `${marker2} ${item.label}${suffix}`) : theme.fg(other ? "success" : "text", `${marker2} ${item.label}${suffix}`);
            pushWrappedLabel(lines, prefix, styled2, width);
            continue;
          }
          const checked = selected.has(item.id);
          const marker = checked ? "[x]" : "[ ]";
          const label = `${marker} ${item.index}. ${item.label}`;
          const styled = isFocused ? theme.fg("accent", label) : theme.fg(checked ? "success" : "text", label);
          pushWrappedLabel(lines, prefix, styled, width);
          if (item.description) {
            addWrapped(lines, theme.fg("muted", item.description), width, "     ");
          }
        }
        if (editMode) {
          lines.push("");
          add(theme.fg("muted", " Write your custom answer:"));
          for (const line of editor.render(Math.max(1, width - 2))) {
            add(` ${line}`);
          }
          lines.push("");
          add(theme.fg("dim", " Enter to save \u2022 Esc to go back"));
        } else {
          lines.push("");
          if (selected.size === 0) {
            add(theme.fg("warning", " Select at least one answer before submitting."));
          }
          const noteLabel = noteMode ? theme.fg("accent", " Note (optional):") : theme.fg("muted", " Note (optional):");
          addWrapped(lines, noteLabel, width, " ");
          for (const line of noteEditor.render(width)) lines.push(line);
          lines.push("");
          if (noteMode) {
            add(theme.fg("dim", " Type note \u2022 Ctrl+J newline \u2022 Enter/Esc back"));
          } else {
            add(theme.fg("dim", " \u2191\u2193 navigate \u2022 Space toggle \u2022 Enter submit \u2022 n note \u2022 Esc cancel"));
          }
        }
        add(theme.fg("accent", "\u2500".repeat(width)));
        if (!noteMode) {
          cachedLines = lines;
          cachedWidth = width;
        }
        return lines;
      }
      return {
        render,
        invalidate: () => {
          cachedLines = void 0;
          noteEditor.invalidate();
        },
        handleInput
      };
    }
  );
}
const SHARED_UI_LOCK_KEY = "__piSharedUiLock";
function getSharedUiLock() {
  const g = globalThis;
  if (!g[SHARED_UI_LOCK_KEY]) {
    let chain = Promise.resolve();
    g[SHARED_UI_LOCK_KEY] = {
      withLock(fn) {
        const prev = chain;
        let release;
        chain = new Promise((r) => {
          release = r;
        });
        return prev.then(fn).finally(() => release());
      }
    };
  }
  return g[SHARED_UI_LOCK_KEY];
}
const sharedUiLock = getSharedUiLock();
function withUILock(fn) {
  return sharedUiLock.withLock(fn);
}
function askUserQuestion(pi) {
  pi.registerTool({
    name: "ask_user_question",
    label: "ask_user_question",
    description: "Ask the user a single question and pause execution until they answer. Use this when requirements are ambiguous, user preferences are needed, a decision would materially affect implementation, or you need confirmation before proceeding. Ask exactly one question per tool call, and prefer multiple separate tool calls over bundling unrelated questions together. The user can press `n` to attach an optional free-text note to their answer (Ctrl+J inserts a newline in the note).",
    promptSnippet: "Use this tool to ask exactly one clarifying question, missing-requirement question, preference question, or decision question before continuing.",
    promptGuidelines: [
      "Ask exactly one question per tool call.",
      "If you need answers to multiple questions, make multiple separate ask_user_question tool calls instead of combining them into one prompt.",
      'Users will always be able to select "Other" to provide custom text input when options are provided.',
      "Use multiSelect: true only when you need multiple answers to the same question.",
      'If you recommend a specific option, make it the first option in the list and add "(Recommended)" at the end of the label.',
      "Prefer this tool over guessing when requirements, preferences, or implementation choices are unclear.",
      "Use this tool when multiple valid implementation paths exist and the preferred path depends on user choice.",
      "The user can press `n` to attach a free-text note to their answer. The note is optional and reaches you only when non-empty. Read it and let it steer your follow-up \u2014 it often contains useful reasoning, hesitation, or context that the bare option label doesn't capture."
    ],
    parameters: AskUserQuestionParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const options = normalizeOptions(params.options);
      const context = params.details?.trim() || void 0;
      const mode = options.length === 0 ? "text" : params.multiSelect ? "multi-select" : "single-select";
      if (signal?.aborted) {
        return cancelledResult(params.question, mode, context);
      }
      if (!ctx.hasUI) {
        return unavailableResult(params.question, mode, "ask_user_question requires interactive mode UI", context);
      }
      return withUILock(async () => {
        if (mode === "text") {
          const editorTitle = context ? `${params.question}

${context}` : params.question;
          const answer = await ctx.ui.editor(editorTitle);
          if (answer === void 0) {
            return cancelledResult(params.question, mode, context);
          }
          return buildResult(params.question, context, mode, [
            { type: "text", label: answer.trim(), value: answer.trim() }
          ]);
        }
        if (mode === "single-select") {
          const result2 = await askSingleChoice(ctx, params.question, context, options);
          if (!result2) {
            return cancelledResult(params.question, mode, context);
          }
          return buildResult(params.question, context, mode, [result2.answer], result2.note);
        }
        const result = await askMultiChoice(ctx, params.question, context, options);
        if (!result) {
          return cancelledResult(params.question, mode, context);
        }
        return buildResult(params.question, context, mode, result.answers, result.note);
      });
    },
    renderCall(args, theme) {
      const options = normalizeOptions(args.options);
      let text = theme.fg("toolTitle", theme.bold("ask_user_question ")) + theme.fg("muted", args.question);
      if (args.multiSelect) {
        text += theme.fg("dim", " [multi-select]");
      }
      if (options.length > 0) {
        const labels = [...options.map((option) => option.label), getOtherLabel(options)].join(", ");
        text += `
${theme.fg("dim", `  Options: ${labels}`)}`;
      }
      return new Text(text, 0, 0);
    },
    renderResult(result, _options, theme) {
      const details = result.details;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }
      if (details.status === "cancelled") {
        return new Text(theme.fg("warning", details.message || "Cancelled"), 0, 0);
      }
      if (details.status === "unavailable") {
        return new Text(theme.fg("warning", details.message || "ask_user_question unavailable"), 0, 0);
      }
      const lines = details.answers.map((answer) => {
        switch (answer.type) {
          case "text":
            return `${theme.fg("success", "\u2713 ")}${theme.fg("accent", answer.label || "(empty response)")}`;
          case "other":
            return `${theme.fg("success", "\u2713 ")}${theme.fg("muted", "Other: ")}${theme.fg("accent", answer.label)}`;
          case "option":
            return `${theme.fg("success", "\u2713 ")}${theme.fg("accent", `${answer.index}. ${answer.label}`)}`;
        }
      });
      if (details.note) {
        lines.push(theme.fg("muted", `Note: ${details.note}`));
      }
      return new Text(lines.join("\n"), 0, 0);
    }
  });
}
export {
  askUserQuestion as default
};
